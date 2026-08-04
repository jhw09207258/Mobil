import { GoogleGenAI, Type, type FunctionCall, type FunctionDeclaration } from "@google/genai";
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { replaceInFile } from "@/lib/apply-edit";

// ============================================================================
// 코드 에이전트 — 에디터 안에서 대화하며 실제로 파일을 고친다.
//
// 동작: 서버가 파일 내용의 "작업 사본"을 들고, 모델이 편집 도구를 호출하면
// 사본에 적용한다. 모델이 더 이상 도구를 부르지 않을 때까지 반복한 뒤 최종
// 내용을 돌려주면, 클라이언트가 Yjs 문서에 반영한다(→ Monaco 갱신 + 자동 저장
// + 공동 편집자에게도 전파).
//
// 제공자: Gemini(권장 — Google AI Studio 키) / Anthropic. 둘 다 없으면 503.
// ※ Antigravity 는 연결 대상이 아니다 — 공개 API 가 아니라 IDE 이고, 서드파티
//   도구로 접근하는 것은 Google 이용약관 위반이라 계정 정지 사유가 된다.
//   Google 자신도 "서드파티 코딩 에이전트에는 AI Studio/Vertex 키를 쓰라"고 안내한다.
// ============================================================================

export const maxDuration = 60;

const MAX_STEPS = 8;
const MAX_FILE_CHARS = 120_000;
/**
 * 루프 전체에 주는 시간 예산(ms). maxDuration(60초)보다 넉넉히 짧게 잡는다.
 *
 * 이 라우트는 최대 8번까지 모델을 **연달아** 부르는데, 한 번이라도 느리면
 * 전체가 60초를 넘긴다. 그때 플랫폼이 요청을 끊으면 응답이 루프 **뒤에서**
 * 한 번에 나가는 구조라 그때까지 적용한 편집이 전부 사라진다 — 사용자
 * 입장에서는 한참 기다린 끝에 아무 일도 안 일어난 것이다.
 * 그래서 다음 단계를 시작하기 전에 남은 예산을 보고, 모자라면 거기서 멈추고
 * **지금까지의 결과를 정상 응답으로 돌려준다**. 잘린 것보다 부분 결과가 낫다.
 */
const STEP_BUDGET_MS = 45_000;

const SYSTEM = `You are a coding agent embedded in an editor, working on one file.

You have tools to edit that file. Use them — do not paste a corrected version
into your reply and ask the user to copy it. When you change something, make the
edit with a tool and then say briefly what you changed and why.

Prefer replace_in_file for targeted changes; old_string must match the file
exactly and appear exactly once (include surrounding lines to make it unique).
Use rewrite_file only when restructuring most of the file.

If the user is only asking a question, answer it without editing. Be concise.`;

type ChatMessage = { role: "user" | "model"; text: string };

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "replace_in_file",
    description:
      "Replace an exact snippet of the file with new text. old_string must appear exactly once.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        old_string: { type: Type.STRING, description: "Exact existing text to replace." },
        new_string: { type: Type.STRING, description: "Replacement text." },
      },
      required: ["old_string", "new_string"],
    },
  },
  {
    name: "rewrite_file",
    description: "Replace the entire file contents. Use only for large restructuring.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        content: { type: Type.STRING, description: "The complete new file contents." },
      },
      required: ["content"],
    },
  },
];

/** 도구 호출 하나를 작업 사본에 적용한다. */
function applyCall(
  call: FunctionCall,
  working: string
): { working: string; result: Record<string, unknown>; edit?: string } {
  const args = (call.args ?? {}) as Record<string, string>;
  if (call.name === "rewrite_file") {
    const next = args.content ?? "";
    return {
      working: next,
      result: { ok: true, message: "File rewritten." },
      edit: "Rewrote the whole file",
    };
  }
  if (call.name === "replace_in_file") {
    const res = replaceInFile(working, args.old_string ?? "", args.new_string ?? "");
    if (!res.ok) return { working, result: { ok: false, error: res.error } };
    const preview = (args.old_string ?? "").split("\n")[0].trim().slice(0, 60);
    return {
      working: res.content,
      result: { ok: true, message: "Edit applied." },
      edit: `Replaced: ${preview}${preview.length >= 60 ? "…" : ""}`,
    };
  }
  return { working, result: { ok: false, error: `Unknown tool ${call.name}` } };
}

export async function POST(request: NextRequest) {
  await requireUser();

  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!geminiKey) {
    return NextResponse.json(
      {
        error:
          "No Gemini API key configured. Create a free key at aistudio.google.com/apikey and set GEMINI_API_KEY on the server. (A Google AI Pro subscription does not include API access.)",
      },
      { status: 503 }
    );
  }

  let body: {
    messages?: ChatMessage[];
    content?: string;
    filename?: string;
    language?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const history = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
  if (history.length === 0) {
    return NextResponse.json({ error: "No message to send." }, { status: 400 });
  }
  let working = body.content ?? "";
  if (working.length > MAX_FILE_CHARS) {
    return NextResponse.json(
      { error: `This file is too large for the agent (max ${MAX_FILE_CHARS.toLocaleString()} characters).` },
      { status: 400 }
    );
  }
  const original = working;

  const ai = new GoogleGenAI({ apiKey: geminiKey });

  // 대화 이력 + 현재 파일 상태를 첫 턴에 함께 준다.
  const contents: {
    role: "user" | "model";
    parts: Record<string, unknown>[];
  }[] = history.map((m, i) => ({
    role: m.role,
    parts: [
      {
        text:
          i === 0
            ? `File: ${body.filename || "untitled"} (${body.language || "plaintext"})\n\n` +
              "```\n" + working + "\n```\n\n" + m.text
            : m.text,
      },
    ],
  }));

  const edits: string[] = [];
  let finalText = "";

  const deadline = Date.now() + STEP_BUDGET_MS;
  let ranOutOfTime = false;

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      // 아직 한 번도 안 돌았으면 예산을 넘겼더라도 한 번은 시도한다 — 첫 턴도
      // 못 돌리고 빈손으로 끝내는 것보다는 낫다.
      if (step > 0 && Date.now() >= deadline) {
        ranOutOfTime = true;
        break;
      }
      const res = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents,
        config: {
          systemInstruction: SYSTEM,
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        },
      });

      const calls = res.functionCalls;
      if (!calls || calls.length === 0) {
        finalText = res.text ?? "";
        break;
      }

      // 모델 턴을 이력에 남긴다 — 파트를 재구성하지 말고 받은 그대로 넣어야 한다.
      // Gemini 3.x 사고 모델은 functionCall 파트에 thoughtSignature 를 붙여 주고,
      // 다음 요청에 그게 없으면 400 "Function call is missing a thought_signature"
      // 로 거절한다.
      const modelParts = (res.candidates?.[0]?.content?.parts ?? []).filter(
        (p) => p.functionCall || p.thoughtSignature || p.thought
      ) as Record<string, unknown>[];
      contents.push({
        role: "model",
        parts: modelParts.length
          ? modelParts
          : calls.map((c) => ({ functionCall: { name: c.name, args: c.args } })),
      });

      const responses: Record<string, unknown>[] = [];
      for (const call of calls) {
        const applied = applyCall(call, working);
        working = applied.working;
        if (applied.edit) edits.push(applied.edit);
        responses.push({
          functionResponse: { name: call.name, response: applied.result },
        });
      }
      contents.push({ role: "user", parts: responses });
    }

    // 시간이 모자라 멈춘 경우에도 200 으로 돌려준다 — 편집은 실제로 적용됐고,
    // 다만 끝까지 못 갔다는 사실을 분명히 알린다(그래야 사용자가 이어서
    // 시킬지 판단할 수 있다).
    const timedOutNote =
      "Stopped early — the agent ran out of time before finishing. " +
      "The edits below were applied; send the request again to continue.";
    return NextResponse.json({
      text: ranOutOfTime
        ? `${finalText ? `${finalText}\n\n` : ""}${timedOutNote}`
        : finalText || (edits.length ? "Done." : "(no response)"),
      content: working,
      changed: working !== original,
      edits,
      incomplete: ranOutOfTime,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/API_KEY|api key|PERMISSION_DENIED/i.test(msg)) {
      return NextResponse.json({ error: "The Gemini API key was rejected." }, { status: 401 });
    }
    if (/RESOURCE_EXHAUSTED|quota|429/i.test(msg)) {
      return NextResponse.json(
        { error: "Gemini rate limit or quota reached — try again shortly." },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: "The agent request failed." }, { status: 502 });
  }
}
