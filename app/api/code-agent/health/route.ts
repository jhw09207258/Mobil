import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { ANTIGRAVITY_AGENT, AGENT_MODELS } from "@/lib/antigravity";

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
    // environment 는 이 에이전트의 필수 필드다(빼면 400). 빈 sources 로 최소
    // 샌드박스만 띄운다 — preview 동안 컴퓨트는 과금되지 않는다.
    const res = await ai.interactions.create({
      agent: ANTIGRAVITY_AGENT,
      agent_config: { type: "antigravity", model: AGENT_MODELS[0] },
      environment: { type: "remote", sources: [] },
      input: "Reply with the single word OK. Do not use any tools.",
      store: false,
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
