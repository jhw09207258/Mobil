import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";

// ============================================================================
// 코드 어시스트 — 에디터에서 선택한 코드에 대해 설명/리팩터/버그 수정/테스트를
// 요청한다. NVIDIA NIM 엔드포인트는 Vercel(icn1)에서 계속 실패하므로
// (docs/ASSESSMENT.md 5.1) 이 화면만큼은 Anthropic 을 직접 호출한다.
// ============================================================================

export const maxDuration = 60;

const ACTIONS = {
  explain: "Explain what this code does, then note anything surprising or risky.",
  refactor:
    "Refactor this code for clarity. Return the rewritten code first, then a short list of what changed and why.",
  fix: "Find bugs in this code. For each, say what input triggers it and what goes wrong, then give the corrected code.",
  tests: "Write focused tests for this code covering the meaningful edge cases.",
} as const;

type Action = keyof typeof ACTIONS;

export async function POST(request: NextRequest) {
  await requireUser();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server." },
      { status: 503 }
    );
  }

  let body: { action?: string; code?: string; language?: string; filename?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const action = body.action as Action;
  const code = (body.code ?? "").trim();
  if (!ACTIONS[action]) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  if (!code) return NextResponse.json({ error: "Select some code first." }, { status: 400 });
  // 컨텍스트 창과 비용을 지키기 위한 상한 — 파일 전체를 통째로 보내지 않는다.
  if (code.length > 60_000) {
    return NextResponse.json(
      { error: "That selection is too large (max ~60,000 characters)." },
      { status: 400 }
    );
  }

  const client = new Anthropic({ apiKey });

  try {
    const message = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system:
        "You are a precise code assistant embedded in an editor. Be concrete and brief. " +
        "When you return code, return it in a fenced block with the correct language tag. " +
        "Do not restate the question or add pleasantries.",
      messages: [
        {
          role: "user",
          content:
            `${ACTIONS[action]}\n\n` +
            `File: ${body.filename || "untitled"} (${body.language || "plaintext"})\n\n` +
            "```" + (body.language || "") + "\n" + code + "\n```",
        },
      ],
    });

    // 안전 분류기가 거절하면 200 + stop_reason:"refusal" 로 온다 — content 를
    // 그냥 읽으면 빈 배열에 접근하게 되므로 먼저 확인한다.
    if (message.stop_reason === "refusal") {
      return NextResponse.json(
        { error: "The request was declined by safety filters." },
        { status: 422 }
      );
    }

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return NextResponse.json({ text: text || "(no response)" });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Rate limited — try again shortly." }, { status: 429 });
    }
    if (e instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "The Anthropic API key is invalid." }, { status: 401 });
    }
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Anthropic API error (${e.status}).` }, { status: 502 });
    }
    return NextResponse.json({ error: "Code assist failed." }, { status: 500 });
  }
}
