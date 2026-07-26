import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { ANTIGRAVITY_AGENT, AGENT_MODELS, agentBaseConfig } from "@/lib/antigravity";
import { CLAUDE_MODELS } from "@/lib/big-brother-claude";

// 코드 에이전트 진단(로그인 필요). /api/code-agent/health 를 브라우저에서 열면
// GEMINI_API_KEY 가 이 배포에 실제로 주입됐는지, 그리고 그 키로 Gemini 호출이
// 되는지를 실제 요청으로 확인해 알려준다. "에이전트가 그냥 안 된다"를
// "키가 없다 / 키가 거부됐다 / 할당량 초과"로 좁혀준다.
// 키 값은 절대 응답에 싣지 않는다(설정 여부와 말미 4자리만).
export const maxDuration = 30;

const MODEL = "gemini-3.5-flash";

/**
 * Antigravity 에이전트(Interactions API)가 이 키로 열리는지 실제로 찔러본다.
 * preview 라 키/프로젝트마다 접근 여부가 다르므로, Code Space 에이전트를
 * 쓰기 전에 여기서 먼저 확인할 수 있어야 한다. 샌드박스 비용이 들지 않도록
 * environment 없이 인사만 시킨다.
 */
async function probeAntigravity(ai: GoogleGenAI) {
  const t = Date.now();
  try {
    // 실제 에이전트와 똑같은 설정으로 부른다 — 여기서 손으로 따로 짜면 필수
    // 필드가 어긋나 멀쩡한 키를 "안 된다"고 오진한다. 다른 건 두 가지뿐:
    // 빈 샌드박스(마운트할 파일이 없다)와 동기 실행(폴링 없이 바로 답을 본다).
    const res = await ai.interactions.create({
      ...agentBaseConfig(AGENT_MODELS[0]),
      environment: { type: "remote", sources: [] },
      background: false,
      input: "Reply with the single word OK. Do not use any tools.",
    });
    return {
      available: true,
      agent: ANTIGRAVITY_AGENT,
      status: res.status,
      elapsedMs: Date.now() - t,
      totalTokens: res.usage?.total_tokens ?? 0,
      reply: (res.output_text ?? "").trim().slice(0, 60),
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      available: false,
      agent: ANTIGRAVITY_AGENT,
      elapsedMs: Date.now() - t,
      // "키에 접근 권한이 없다"와 "요청을 잘못 만들었다"를 섞으면 안 된다 —
      // 전자는 사용자가, 후자는 우리가 고쳐야 하는 문제다. 400 대부분은 후자다.
      reason: /NOT_FOUND|not found|unsupported|is not available/i.test(detail)
        ? "agent-not-available-on-this-key"
        : /PERMISSION_DENIED/i.test(detail)
        ? "permission-denied"
        : /RESOURCE_EXHAUSTED|quota|429/i.test(detail)
        ? "quota"
        : /^4\d\d|INVALID_ARGUMENT|Missing required|invalid/i.test(detail)
        ? "bad-request-our-bug"
        : "request-failed",
      detail: detail.slice(0, 300),
    };
  }
}

/**
 * Claude 키가 이 배포에 실제로 주입됐고 통하는지 확인한다.
 * 값은 절대 돌려주지 않는다(변수명과 끝 4자리만).
 */
async function probeClaude() {
  const key = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
  const varName = process.env.CLAUDE_API_KEY
    ? "CLAUDE_API_KEY"
    : process.env.ANTHROPIC_API_KEY
    ? "ANTHROPIC_API_KEY"
    : null;
  if (!key) {
    return {
      available: false,
      keyConfigured: false,
      hint: "No Claude key in this deployment. Vercel applies env-var changes only to NEW deployments — redeploy if you just added it.",
    };
  }
  const t = Date.now();
  try {
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: CLAUDE_MODELS[0].id,
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with the single word OK." }],
    });
    // 거절은 예외가 아니라 정상 200 으로 온다 — content 를 읽기 전에 확인한다.
    if (msg.stop_reason === "refusal") {
      return { available: true, keyConfigured: true, variable: varName, refused: true };
    }
    const first = msg.content.find((b) => b.type === "text");
    return {
      available: true,
      keyConfigured: true,
      variable: varName,
      keyTail: `...${key.slice(-4)}`,
      model: CLAUDE_MODELS[0].id,
      elapsedMs: Date.now() - t,
      reply: first && first.type === "text" ? first.text.trim().slice(0, 40) : "",
      totalTokens: (msg.usage?.input_tokens ?? 0) + (msg.usage?.output_tokens ?? 0),
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      available: false,
      keyConfigured: true,
      variable: varName,
      keyTail: `...${key.slice(-4)}`,
      elapsedMs: Date.now() - t,
      reason: /authentication|401|invalid.*api.?key/i.test(detail)
        ? "key-rejected"
        : /rate.?limit|429/i.test(detail)
        ? "quota"
        : /not_found|404|model/i.test(detail)
        ? "model-not-available-on-this-key"
        : "request-failed",
      detail: detail.slice(0, 300),
    };
  }
}

export async function GET() {
  await requireUser();

  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const varName = process.env.GEMINI_API_KEY
    ? "GEMINI_API_KEY"
    : process.env.GOOGLE_API_KEY
    ? "GOOGLE_API_KEY"
    : null;

  if (!key) {
    return NextResponse.json(
      {
        ok: false,
        keyConfigured: false,
        hint:
          "No Gemini key is present in this deployment. Note that Vercel only applies environment-variable changes to NEW deployments — if you just added it, redeploy.",
      },
      { status: 503 }
    );
  }

  const started = Date.now();
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: "Reply with the single word OK." }] }],
    });
    return NextResponse.json({
      ok: true,
      keyConfigured: true,
      variable: varName,
      keyTail: `...${key.slice(-4)}`,
      model: MODEL,
      elapsedMs: Date.now() - started,
      reply: (res.text ?? "").trim().slice(0, 40),
      antigravity: await probeAntigravity(ai),
      claude: await probeClaude(),
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const rejected = /API_KEY|api key|PERMISSION_DENIED|invalid/i.test(detail);
    const quota = /RESOURCE_EXHAUSTED|quota|429/i.test(detail);
    return NextResponse.json(
      {
        ok: false,
        keyConfigured: true,
        variable: varName,
        keyTail: `...${key.slice(-4)}`,
        model: MODEL,
        elapsedMs: Date.now() - started,
        reason: rejected ? "key-rejected" : quota ? "quota" : "request-failed",
        detail: detail.slice(0, 300),
      },
      { status: 502 }
    );
  }
}
