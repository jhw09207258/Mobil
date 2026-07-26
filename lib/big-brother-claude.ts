import Anthropic from "@anthropic-ai/sdk";

// ============================================================================
// Big Brother 의 Claude 백엔드.
//
// Gemini 러너와 같은 인터페이스(스트리밍 텍스트 + 도구 루프)를 제공하므로
// 라우트는 모델 id 만 보고 어느 쪽을 부를지 고르면 된다.
//
// 도구 스키마는 다시 쓰지 않는다 — SOPHIA_TOOLS 는 OpenAI 형식이고, Anthropic
// 의 input_schema 가 같은 JSON Schema 를 받는다(감싼 function 만 벗기면 된다).
//
// 주의(현행 API): Opus 5 계열은 temperature/top_p/top_k 와 budget_tokens 를
// 거부한다(400). 사고는 adaptive 가 기본이고, 안전 분류기가 요청을 거절하면
// 예외가 아니라 stop_reason: "refusal" 로 200 이 온다 — content 를 읽기 전에
// 반드시 확인해야 한다.
// ============================================================================

export const CLAUDE_MODELS = [
  { id: "claude-opus-5", label: "Claude Opus 5 — deepest reasoning" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 — balanced" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 — fastest" },
] as const;

export function isClaudeModel(m: string | undefined): boolean {
  return !!m && CLAUDE_MODELS.some((x) => x.id === m);
}

/** OpenAI 형식 도구 선언을 Anthropic 형식으로. 스키마는 그대로 재사용한다. */
export function toClaudeTools(
  openAiTools: readonly {
    function: { name: string; description?: string; parameters?: unknown };
  }[]
): Anthropic.Tool[] {
  return openAiTools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
  }));
}

export type BbMessage = { role: string; content: string | null };

/** 대화 이력을 Anthropic messages 로. 토큰을 아끼려고 최근 것만 보낸다. */
export function toClaudeMessages(
  history: BbMessage[],
  maxTurns: number
): Anthropic.MessageParam[] {
  const rows = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-maxTurns)
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: String(m.content),
    }));
  // 첫 메시지는 반드시 user 여야 한다 — 잘라내다 보면 assistant 로 시작할 수 있다.
  while (rows.length > 0 && rows[0].role !== "user") rows.shift();
  return rows;
}

export type ClaudeRunResult = {
  text: string;
  error?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

/** 도구 결과가 너무 크면 컨텍스트를 통째로 잡아먹는다. */
function clamp(value: unknown, maxChars: number): string {
  const json = JSON.stringify(value) ?? "null";
  if (json.length <= maxChars) return json;
  return JSON.stringify({
    truncated: true,
    note: `Result was ${json.length} characters; showing the first ${maxChars}.`,
    preview: json.slice(0, maxChars),
  });
}

export async function runBigBrotherClaude(opts: {
  apiKey: string;
  model: string;
  system: string;
  history: BbMessage[];
  tools: Anthropic.Tool[];
  execute: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** 텍스트 델타를 클라이언트로 흘려보낸다. */
  forward: (text: string) => void;
  maxRounds: number;
  maxHistoryTurns: number;
  maxToolResultChars: number;
  deadline: number;
}): Promise<ClaudeRunResult> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const messages = toClaudeMessages(opts.history, opts.maxHistoryTurns);
  if (messages.length === 0) {
    return { text: "", error: "Nothing to send.", inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }

  let full = "";
  let inputTokens = 0;
  let outputTokens = 0;

  for (let round = 0; round < opts.maxRounds; round++) {
    if (Date.now() >= opts.deadline) {
      return {
        text: full,
        error: full ? undefined : "Big Brother ran out of time before finishing.",
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      };
    }

    // 마지막 라운드는 도구를 빼서 반드시 글로 마무리되게 한다.
    const isLast = round === opts.maxRounds - 1;

    let message: Anthropic.Message;
    try {
      // 스트리밍을 쓰는 이유: 큰 max_tokens 로 논스트리밍을 하면 HTTP 타임아웃에
      // 걸린다. 안전 분류기가 거절하면 서버가 알아서 대체 모델로 넘긴다
      // (fallbacks: "default").
      const stream = client.beta.messages.stream({
        model: opts.model,
        max_tokens: 16000,
        system: opts.system,
        messages,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        ...(isLast ? {} : { tools: opts.tools }),
      });
      stream.on("text", (delta) => {
        full += delta;
        opts.forward(delta);
      });
      message = (await stream.finalMessage()) as unknown as Anthropic.Message;
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return {
        text: full,
        error: full ? undefined : claudeErrorMessage(detail),
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      };
    }

    inputTokens += message.usage?.input_tokens ?? 0;
    outputTokens += message.usage?.output_tokens ?? 0;

    // 거절은 예외가 아니라 정상 200 으로 온다 — content 를 읽기 전에 확인한다.
    if (message.stop_reason === "refusal") {
      return {
        text: full,
        error: full
          ? undefined
          : "Claude declined this request (safety classifier). Try rephrasing, or switch model.",
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      };
    }

    if (message.stop_reason !== "tool_use") break;

    const calls = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (calls.length === 0) break;

    // 모델 턴은 받은 그대로 되돌려준다(도구 블록이 빠지면 다음 요청이 깨진다).
    messages.push({ role: "assistant", content: message.content });

    // 병렬 호출 결과는 반드시 "하나의" user 메시지에 모아 보낸다 —
    // 나눠 보내면 모델이 병렬 호출을 그만두게 학습된다.
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of calls) {
      let out: unknown;
      let isError = false;
      try {
        out = await opts.execute(call.name, (call.input ?? {}) as Record<string, unknown>);
      } catch (e) {
        isError = true;
        out = { error: e instanceof Error ? e.message : "Tool failed." };
      }
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: clamp(out, opts.maxToolResultChars),
        ...(isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: "user", content: results });
  }

  return { text: full, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

function claudeErrorMessage(detail: string): string {
  if (/authentication|invalid.*api.?key|401/i.test(detail)) {
    return "Big Brother's Claude API key was rejected.";
  }
  if (/rate.?limit|429/i.test(detail)) {
    return "Claude rate limit reached — try again shortly.";
  }
  if (/overloaded|529/i.test(detail)) {
    return "Claude is temporarily overloaded — try again shortly.";
  }
  return `Big Brother's Claude request failed: ${detail.slice(0, 200)}`;
}
