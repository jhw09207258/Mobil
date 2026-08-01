import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { CLAUDE_MODELS } from "@/lib/big-brother-claude";

// 코드 에이전트 진단(로그인 필요). /api/code-agent/health 를 브라우저에서 열면
// GEMINI_API_KEY 가 이 배포에 실제로 주입됐는지, 그리고 그 키로 Gemini 호출이
// 되는지를 실제 요청으로 확인해 알려준다. "에이전트가 그냥 안 된다"를
// "키가 없다 / 키가 거부됐다 / 할당량 초과"로 좁혀준다.
// 키 값은 절대 응답에 싣지 않는다(설정 여부와 말미 4자리만).
export const maxDuration = 30;

const MODEL = "gemini-3.5-flash";

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
      // 청구 문제는 키 문제와 완전히 다르다 — 뭉뚱그리면 멀쩡한 키를 의심하게 된다.
      reason: /credit balance|Plans & Billing|billing/i.test(detail)
        ? "no-credit"
        : /authentication|401|invalid.*api.?key/i.test(detail)
        ? "key-rejected"
        : /rate.?limit|429/i.test(detail)
        ? "quota"
        : /not_found|404|model/i.test(detail)
        ? "model-not-available-on-this-key"
        : "request-failed",
      ...(/credit balance|Plans & Billing|billing/i.test(detail)
        ? {
            hint: "The key works — the Anthropic account has no credit. Add a payment method or buy credits at console.anthropic.com/settings/billing.",
          }
        : {}),
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
