import { createClient } from "@/lib/supabase/server";
import { SOPHIA_TOOLS, executeSophiaTool } from "@/app/(app)/sophia/tools";

// Llama 70B 완성 전체를 기다리면 서버리스 함수 기본 제한 시간(대개 10초)을
// 넘기기 쉬워 "응답이 아예 안 옴" 증상으로 이어진다. 스트리밍으로 바꿔도
// 함수 실행 시간 자체는 그대로 걸리므로, 더 긴 응답도 끝까지 받을 수 있게
// 제한 시간을 넉넉히 늘린다(플랫폼이 지원하는 한도 내로 자동 clamp됨).
export const maxDuration = 60;

const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_MODEL = "meta/llama-3.3-70b-instruct";

// 도구 호출이 계속 이어지는 걸 막기 위한 최대 라운드 수 — 마지막 라운드는
// tools 를 아예 안 붙여서 반드시 텍스트 답으로 마무리되게 한다.
const MAX_TOOL_ROUNDS = 4;

// 요청 전체 예산(ms). NVIDIA fetch 에 타임아웃이 없으면 응답이 멈춘(hang)
// 순간 함수가 maxDuration(60s)까지 대기하다 Vercel 에 강제 종료되어
// FUNCTION_INVOCATION_TIMEOUT 만 남고 원인을 못 남긴다. 예산을 두어 그 전에
// 스스로 중단하고 명확한 진단을 저장한다. maxDuration 보다 넉넉히 짧게 잡아
// DB 기록·정리 시간을 남긴다.
const REQUEST_BUDGET_MS = 48_000;
// 개별 NVIDIA 호출(연결+스트림 소비 전체)에 허용하는 최대 시간.
const PER_CALL_TIMEOUT_MS = 30_000;

const SYSTEM_PROMPT = `You are Sophia, the AI assistant built into Mobil (a personal workspace for documents, code, sheets, files and mind maps). Be helpful, concise, and clear.

You have tools to search, read, create, and edit the user's Mobil content, and to search external papers/GitHub code (Big Brother). Use them whenever they'd help answer the question or complete a request — don't just describe what you would do, actually call the tool. Search first if you need an id you don't already have. Before a 'replace' edit that overwrites existing content, briefly confirm that's what the user wants unless they clearly already asked for exactly that. After using a tool, tell the user plainly what you found or did (don't narrate the tool call itself).`;

type ToolCallOut = { id: string; type: "function"; function: { name: string; arguments: string } };

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCallOut[];
  tool_call_id?: string;
};

/** 키 순회로도 해소 안 되는 "요청 자체가 거부됨"(엔드포인트가 이 파라미터
 * 조합을 지원하지 않음 등). 이 경우 같은 요청을 재시도해봐야 소용없고,
 * 파라미터를 바꿔(스트리밍/도구 끄기) 강등 재시도해야 한다. */
function isInvalidRequestStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 429;
}

/** 키를 바꿔 재시도할 가치가 있는 오류(인증/레이트리밋/서버 오류). */
function isKeyRetryableStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 429 || status >= 500;
}

/** NVIDIA_API_KEY_2 가 메인(Llama) 키이므로 항상 먼저 시도하고, 실패하면
 * NVIDIA_API_KEY 로 넘어간다(무작위 로드밸런싱 없이 고정 우선순위). */
function getOrderedKeys(): string[] {
  return [process.env.NVIDIA_API_KEY_2, process.env.NVIDIA_API_KEY].filter(
    (k): k is string => !!k
  );
}

type NvidiaCallResult =
  | { ok: true; upstream: Response }
  | { ok: false; upstreamStatus: number | null; detail: string };

/** 키들을 순서대로 시도한다. 실패 시 업스트림 상태코드와 본문 일부를 그대로
 * 돌려줘 호출자가 강등(파라미터 변경) 여부를 판단하고, 사용자에게도 원인이
 * 보이게 한다. deadline 을 넘겼거나 응답이 멈추면 타임아웃으로 중단한다. */
async function callNvidia(
  messages: ChatMessage[],
  opts: { tools: boolean; stream: boolean; deadline: number }
): Promise<NvidiaCallResult> {
  const keys = getOrderedKeys();
  if (keys.length === 0) {
    return { ok: false, upstreamStatus: null, detail: "missing NVIDIA_API_KEY" };
  }

  let lastStatus: number | null = null;
  let lastDetail = "network error";
  for (let i = 0; i < keys.length; i++) {
    const isLastKey = i === keys.length - 1;
    // 이 호출에 남은 시간 = min(호출당 상한, 요청 전체 예산의 잔여분).
    const remaining = opts.deadline - Date.now();
    if (remaining <= 500) {
      return { ok: false, upstreamStatus: null, detail: "timed out before NVIDIA responded" };
    }
    const timeoutMs = Math.min(PER_CALL_TIMEOUT_MS, remaining);
    try {
      const res = await fetch(NVIDIA_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${keys[i]}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: NVIDIA_MODEL,
          messages,
          temperature: 0.2,
          top_p: 0.7,
          max_tokens: 1024,
          stream: opts.stream,
          ...(opts.tools ? { tools: SOPHIA_TOOLS } : {}),
        }),
        // 타임아웃이 없으면 NVIDIA 가 응답을 멈췄을 때 함수 전체가 maxDuration
        // 까지 매달려 FUNCTION_INVOCATION_TIMEOUT 만 남는다. 명시적으로 끊는다.
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return { ok: true, upstream: res };
      lastStatus = res.status;
      const text = await res.text().catch(() => "");
      lastDetail = text.slice(0, 300);
      console.error(
        `[sophia] NVIDIA error (key ${i + 1}/${keys.length}, tools=${opts.tools}, stream=${opts.stream})`,
        res.status,
        text
      );
      // 요청 형식 거부(400 등)는 키를 바꿔도 똑같이 실패한다 — 즉시 반환해
      // 호출자가 파라미터를 강등해 재시도하게 한다.
      if (!isKeyRetryableStatus(res.status) || isLastKey) {
        return { ok: false, upstreamStatus: res.status, detail: lastDetail };
      }
    } catch (e) {
      const timedOut =
        e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
      lastDetail = timedOut
        ? `request timed out after ${Math.round(timeoutMs / 1000)}s — NVIDIA endpoint did not respond`
        : e instanceof Error
          ? e.message
          : "network error";
      console.error(`[sophia] NVIDIA request failed (key ${i + 1}/${keys.length})`, lastDetail);
      // 타임아웃은 키를 바꿔도 같은 원인일 가능성이 높지만, 두 번째 키가
      // 다른 계정/엔드포인트일 수 있으니 마지막 키까지는 시도해본다.
      if (isLastKey) return { ok: false, upstreamStatus: null, detail: lastDetail };
    }
  }
  return { ok: false, upstreamStatus: lastStatus, detail: lastDetail };
}

/**
 * 한 라운드의 SSE 스트림을 소비한다. tool_calls 델타가 하나라도 보이면 이
 * 라운드는 "도구 호출" 라운드로 간주해 텍스트를 클라이언트로 내보내지
 * 않고 조용히 누적만 한다. tool_calls 가 전혀 없으면 최종 답변 라운드이므로
 * 델타가 오는 즉시 클라이언트로 스트리밍한다.
 */
async function consumeStream(
  upstream: Response,
  forward: (chunk: string) => void
): Promise<{ content: string; toolCalls: ToolCallOut[] }> {
  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let hasToolCalls = false;
  const callsByIndex = new Map<number, { id: string; name: string; args: string }>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let json: {
        choices?: {
          delta?: {
            content?: string;
            tool_calls?: {
              index: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }[];
          };
        }[];
      };
      try {
        json = JSON.parse(payload);
      } catch {
        continue; // 중간에 잘려 온 청크 등 — 무시하고 계속.
      }
      const delta = json?.choices?.[0]?.delta;
      if (delta?.tool_calls?.length) {
        hasToolCalls = true;
        for (const tc of delta.tool_calls) {
          const existing = callsByIndex.get(tc.index) ?? { id: "", name: "", args: "" };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name += tc.function.name;
          if (tc.function?.arguments) existing.args += tc.function.arguments;
          callsByIndex.set(tc.index, existing);
        }
      } else if (delta?.content && !hasToolCalls) {
        content += delta.content;
        forward(delta.content);
      }
    }
  }

  const toolCalls: ToolCallOut[] = [...callsByIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, c]) => ({
      id: c.id || `call_${Math.random().toString(36).slice(2)}`,
      type: "function" as const,
      function: { name: c.name, arguments: c.args },
    }));

  return { content, toolCalls };
}

/** 비스트리밍 응답 파싱 — 도구+스트리밍 조합을 거부하는 엔드포인트용 강등 경로. */
async function consumeJson(
  upstream: Response
): Promise<{ content: string; toolCalls: ToolCallOut[] }> {
  const json: {
    choices?: {
      message?: {
        content?: string | null;
        tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
      };
    }[];
  } = await upstream.json();
  const msg = json?.choices?.[0]?.message;
  const toolCalls: ToolCallOut[] = (msg?.tool_calls ?? []).map((tc, i) => ({
    id: tc.id || `call_${i}_${Math.random().toString(36).slice(2)}`,
    type: "function" as const,
    function: { name: tc.function?.name ?? "", arguments: tc.function?.arguments ?? "" },
  }));
  return { content: msg?.content ?? "", toolCalls };
}

// 도구 요청 방식. NVIDIA NIM 배포 버전에 따라 tools+stream 조합을 거부하는
// 경우가 있어, 거부(4xx)를 만나면 한 단계씩 강등한다:
//   stream(도구+스트리밍) → nonstream(도구+비스트리밍) → off(도구 없이 스트리밍)
// off 까지 가면 도구는 못 쓰지만 일반 챗봇으로는 반드시 동작한다.
type ToolsMode = "stream" | "nonstream" | "off";

export async function POST(req: Request) {
  let body: { conversationId?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

  const conversationId = body.conversationId;
  const trimmed = String(body.content ?? "").trim();
  if (!conversationId || !trimmed) {
    return new Response("Missing conversationId or content.", { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Authentication required.", { status: 401 });

  const { data: conv } = await supabase
    .from("ai_conversations")
    .select("id, title")
    .eq("id", conversationId)
    .single();
  if (!conv) return new Response("Conversation not found.", { status: 404 });

  const { error: insertErr } = await supabase
    .from("ai_messages")
    .insert({ conversation_id: conversationId, role: "user", content: trimmed });
  if (insertErr) return new Response("Failed to save message.", { status: 500 });

  const { data: history } = await supabase
    .from("ai_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(history ?? []).map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
  ];

  const isFirstMessage = (history ?? []).length <= 1;

  // 이 요청이 스스로 멈춰야 하는 절대 시각(ms). 모든 NVIDIA 호출·도구 라운드가
  // 이 안에서 끝나야 Vercel 이 함수를 죽이기 전에 진단을 남길 수 있다.
  const deadline = Date.now() + REQUEST_BUDGET_MS;

  /** 사용자에게도, 나중에 DB 로그를 읽는 사람에게도 원인이 바로 보이도록
   * 흔한 실패 유형을 사람이 읽을 수 있는 힌트로 바꾼다. */
  const formatError = (r: { upstreamStatus: number | null; detail: string }): string => {
    const s = r.upstreamStatus;
    const d = r.detail || "no detail";
    if (d.includes("missing NVIDIA_API_KEY")) {
      return "Sophia isn't configured: no NVIDIA_API_KEY / NVIDIA_API_KEY_2 is set in this deployment's environment variables.";
    }
    if (d.includes("timed out")) {
      return `Sophia's request to NVIDIA timed out — the NVIDIA API isn't responding from the server (region icn1). This usually means the endpoint or key is wrong, or NVIDIA is unreachable from this deployment. Detail: ${d}`;
    }
    if (s === 401 || s === 403) {
      return `Sophia's NVIDIA API key was rejected (HTTP ${s}). The key is missing, invalid, or lacks access to the model. Detail: ${d}`;
    }
    if (s === 404) {
      return `NVIDIA returned 404 — the model "${NVIDIA_MODEL}" isn't available to this key/endpoint. Detail: ${d}`;
    }
    if (s === 429) {
      return `NVIDIA rate limit hit (HTTP 429). Try again shortly. Detail: ${d}`;
    }
    return `Sophia is unavailable right now (NVIDIA ${s ?? "network"}: ${d})`;
  };

  /** 실패 진단을 assistant 메시지로 남긴다 — 화면에도 남고, DB 로그로도
   * 정확한 원인을 되짚을 수 있다(그렇지 않으면 "그냥 안 됨"만 남는다). */
  const saveAssistant = async (content: string) => {
    await supabase
      .from("ai_messages")
      .insert({ conversation_id: conversationId, role: "assistant", content });
    const nextTitle =
      isFirstMessage && conv.title === "New chat" ? trimmed.slice(0, 60) : conv.title;
    await supabase.from("ai_conversations").update({ title: nextTitle }).eq("id", conversationId);
  };

  const isTimeout = (r: NvidiaCallResult) =>
    !r.ok && r.upstreamStatus === null && r.detail.includes("timed out");
  const isRejectedShape = (r: NvidiaCallResult) =>
    !r.ok && r.upstreamStatus !== null && isInvalidRequestStatus(r.upstreamStatus);

  // 첫 업스트림 연결은 스트림을 열기 전에 확보한다 — 완전 실패(키 미설정,
  // 전 모드 거부 등)라면 이전처럼 적절한 HTTP 상태코드로 바로 응답할 수 있다.
  let toolsMode: ToolsMode = "stream";
  let first: NvidiaCallResult = await callNvidia(messages, { tools: true, stream: true, deadline });

  // (a) 엔드포인트가 tools+stream "형식"을 거부(4xx)하면 tools+nonstream →
  //     그것도 거부면 도구 끄기로 한 단계씩 강등.
  if (isRejectedShape(first)) {
    toolsMode = "nonstream";
    first = await callNvidia(messages, { tools: true, stream: false, deadline });
    if (isRejectedShape(first)) {
      toolsMode = "off";
      first = await callNvidia(messages, { tools: false, stream: true, deadline });
    }
  } else if (isTimeout(first)) {
    // (b) tools+stream 이 응답 없이 멈추면 도구 페이로드가 원인일 수 있으니
    //     곧바로 "도구 없는 일반 챗봇"으로 한 번 더 시도한다(nonstream 은 건너뛴다
    //     — 멈추는 상황에서 중간 단계에 예산을 더 쓰지 않기 위함).
    toolsMode = "off";
    first = await callNvidia(messages, { tools: false, stream: true, deadline });
  }
  if (!first.ok) {
    // 스트림을 열기 전에 완전히 실패 — 진단을 DB 에도 남기고, 클라이언트에는
    // 200 텍스트로 그대로 흘려보낸다(스트림 리더가 항상 본문을 읽으므로
    // 사용자가 반드시 원인 문구를 보게 된다).
    const diagnostic = formatError(first);
    await saveAssistant(diagnostic);
    return new Response(diagnostic, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  if (toolsMode !== "stream") {
    console.warn(`[sophia] degraded tools mode: ${toolsMode}`);
  }

  const firstUpstream = first.upstream;
  const firstWasStream = toolsMode !== "nonstream";

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const forward = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      let full = "";
      let failed: string | null = null;

      try {
        let pending: { upstream: Response; isStream: boolean } | null = {
          upstream: firstUpstream,
          isStream: firstWasStream,
        };

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const isLastAllowedRound = round === MAX_TOOL_ROUNDS - 1;

          if (!pending) {
            // 예산을 넘겼으면 더 부르지 않고, 지금까지 받은 답으로 마무리한다.
            if (Date.now() >= deadline) {
              if (!full) failed = "Sophia ran out of time before finishing (request budget exceeded).";
              break;
            }
            // 마지막 허용 라운드거나 도구가 꺼졌으면 tools 없이 스트리밍으로
            // 최종 답을 받는다. 그 외에는 현재 모드대로 도구를 붙인다.
            const useTools = !isLastAllowedRound && toolsMode !== "off";
            const wantStream = !useTools || toolsMode === "stream";
            const attempt = await callNvidia(messages, { tools: useTools, stream: wantStream, deadline });
            if (!attempt.ok) {
              failed = formatError(attempt);
              break;
            }
            pending = { upstream: attempt.upstream, isStream: wantStream };
          }

          const wasStream = pending.isStream;
          const { content, toolCalls } = wasStream
            ? await consumeStream(pending.upstream, forward)
            : await consumeJson(pending.upstream);
          pending = null;

          if (toolCalls.length > 0 && !isLastAllowedRound) {
            messages.push({ role: "assistant", content: content || null, tool_calls: toolCalls });
            for (const call of toolCalls) {
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(call.function.arguments || "{}");
              } catch {
                // 인자 JSON 이 깨져 왔으면 빈 인자로 실행해 도구가 명확한 에러를 돌려주게 한다.
              }
              const result = await executeSophiaTool(call.function.name, args);
              messages.push({
                role: "tool",
                tool_call_id: call.id,
                content: JSON.stringify(result),
              });
            }
            continue;
          }

          // 스트리밍 경로는 consumeStream 이 델타를 이미 클라이언트로 내보냈다.
          // 비스트리밍(JSON) 경로의 직접 답변만 여기서 한 번에 내보낸다.
          if (!wasStream && content) forward(content);
          full = content;
          break;
        }
      } finally {
        // 성공이면 최종 답을, 실패면 진단 문구를 — 어느 쪽이든 assistant
        // 메시지로 저장해 화면·DB 양쪽에 흔적을 남긴다.
        const finalContent = failed && !full ? failed : full || "…";
        if (failed && !full) controller.enqueue(encoder.encode(failed));
        await saveAssistant(finalContent);
        controller.close();
      }
    },
    cancel() {},
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
