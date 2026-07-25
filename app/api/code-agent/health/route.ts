import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

// 코드 에이전트 진단(로그인 필요). /api/code-agent/health 를 브라우저에서 열면
// GEMINI_API_KEY 가 이 배포에 실제로 주입됐는지, 그리고 그 키로 Gemini 호출이
// 되는지를 실제 요청으로 확인해 알려준다. "에이전트가 그냥 안 된다"를
// "키가 없다 / 키가 거부됐다 / 할당량 초과"로 좁혀준다.
// 키 값은 절대 응답에 싣지 않는다(설정 여부와 말미 4자리만).
export const maxDuration = 30;

const MODEL = "gemini-3.5-flash";

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
