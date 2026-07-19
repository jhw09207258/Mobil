import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Sophia 진단 엔드포인트(관리자 전용). 브라우저에서 /api/sophia/health 를 열면
// 설정된 NVIDIA 키 각각에 대해 세 가지 요청 조합(비스트리밍 / 도구+비스트리밍 /
// 도구+스트리밍)을 실제로 날려 상태코드와 오류 본문을 JSON 으로 보고한다.
// "Sophia 가 그냥 안 된다" 를 어떤 키의 어떤 조합이 왜 실패하는지로 바꿔준다.
// 키 자체는 절대 응답에 싣지 않는다(이름과 말미 4자리만).
export const maxDuration = 30;

const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_MODEL = "meta/llama-3.3-70b-instruct";

const PROBE_TOOL = [
  {
    type: "function",
    function: {
      name: "ping",
      description: "Health-check tool. Never actually called.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

type ProbeResult = {
  config: string;
  ok: boolean;
  status: number | null;
  detail: string | null;
};

async function probe(
  key: string,
  opts: { tools: boolean; stream: boolean }
): Promise<ProbeResult> {
  const config = `${opts.tools ? "tools" : "no-tools"}+${opts.stream ? "stream" : "json"}`;
  try {
    const res = await fetch(NVIDIA_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: NVIDIA_MODEL,
        messages: [{ role: "user", content: "Reply with the single word: pong" }],
        max_tokens: 8,
        stream: opts.stream,
        ...(opts.tools ? { tools: PROBE_TOOL } : {}),
      }),
      // NVIDIA 가 응답을 멈추는 게 바로 진단 대상이므로 짧게 끊는다 — 그래야
      // health 자체가 FUNCTION_INVOCATION_TIMEOUT 으로 죽지 않고 "timed out"
      // 이라는 결과를 돌려준다.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { config, ok: false, status: res.status, detail: text.slice(0, 300) || null };
    }
    // 응답 본문을 끝까지 읽어 연결을 정리한다(스트리밍이면 몇 청크 확인).
    if (opts.stream && res.body) {
      const reader = res.body.getReader();
      let got = 0;
      while (got < 3) {
        const { done } = await reader.read();
        if (done) break;
        got++;
      }
      await reader.cancel().catch(() => {});
    } else {
      await res.text().catch(() => {});
    }
    return { config, ok: true, status: res.status, detail: null };
  } catch (e) {
    return {
      config,
      ok: false,
      status: null,
      detail: e instanceof Error ? e.message : "network error",
    };
  }
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  const keys: { name: string; value: string }[] = [];
  if (process.env.NVIDIA_API_KEY_2) {
    keys.push({ name: "NVIDIA_API_KEY_2 (primary)", value: process.env.NVIDIA_API_KEY_2 });
  }
  if (process.env.NVIDIA_API_KEY) {
    keys.push({ name: "NVIDIA_API_KEY (fallback)", value: process.env.NVIDIA_API_KEY });
  }

  if (keys.length === 0) {
    return NextResponse.json({
      configured: false,
      message: "No NVIDIA_API_KEY / NVIDIA_API_KEY_2 set in this deployment's environment.",
    });
  }

  // 세 조합을 동시에 던진다 — 순차로 하면(각 8s) NVIDIA 가 멈춘 경우 총합이
  // maxDuration 을 넘어 health 마저 타임아웃된다. 병렬이면 키당 ~8s 로 끝난다.
  const report = [];
  for (const key of keys) {
    const results = await Promise.all([
      probe(key.value, { tools: false, stream: false }),
      probe(key.value, { tools: true, stream: false }),
      probe(key.value, { tools: true, stream: true }),
    ]);
    report.push({
      key: key.name,
      keySuffix: `…${key.value.slice(-4)}`,
      results,
    });
  }

  return NextResponse.json({ configured: true, model: NVIDIA_MODEL, report });
}
