import { GoogleGenAI, type FunctionDeclaration } from "@google/genai";

// ============================================================================
// Big Brother 의 Gemini 백엔드.
//
// 기존 NVIDIA(Llama) 경로는 Vercel icn1 에서 응답이 오지 않는 상태가 계속돼
// 사실상 못 쓴다. 같은 도구 세트를 Gemini 로도 돌릴 수 있게 해서, 키가 있으면
// 이쪽이 기본이 된다.
//
// 도구 스키마를 다시 쓸 필요는 없다 — SOPHIA_TOOLS 는 OpenAI 형식(JSON Schema)
// 이고, Gemini 의 parametersJsonSchema 가 바로 그 형식을 받는다.
// ============================================================================

export const BIG_BROTHER_MODEL = "gemini-3.5-flash";

/**
 * 어시스턴트에서 고를 수 있는 모델.
 *
 * 3.1 Pro 는 추론이 가장 강하지만(1M 컨텍스트, 도구 호출 지원) preview 이고
 * flash 대비 훨씬 비싸다 — 기본값은 flash 로 두고 필요할 때 올려 쓰게 한다.
 */
export const BIG_BROTHER_MODELS = [
  { id: "gemini-3.5-flash", label: "3.5 Flash — fast, cheap (default)" },
  { id: "gemini-3.6-flash", label: "3.6 Flash — newer, still fast" },
  { id: "gemini-3.1-pro-preview", label: "3.1 Pro — deepest reasoning, costly" },
] as const;

export function isBigBrotherModel(m: string | undefined): boolean {
  return !!m && BIG_BROTHER_MODELS.some((x) => x.id === m);
}

/** OpenAI 형식 도구 선언을 Gemini 형식으로. 스키마는 그대로 재사용한다. */
export function toGeminiTools(
  openAiTools: readonly {
    function: { name: string; description?: string; parameters?: unknown };
  }[]
): FunctionDeclaration[] {
  return openAiTools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    parametersJsonSchema: t.function.parameters,
  }));
}

export type BbMessage = { role: string; content: string | null };

/**
 * 대화 이력을 Gemini contents 로. 토큰을 아끼려고 최근 것만 보낸다 —
 * 오래된 턴은 답변 품질보다 비용에 훨씬 크게 기여한다.
 */
export function toGeminiContents(
  history: BbMessage[],
  maxTurns: number
): { role: "user" | "model"; parts: { text: string }[] }[] {
  return history
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-maxTurns)
    .map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: String(m.content) }],
    }));
}

/** 도구 결과가 너무 크면 컨텍스트를 통째로 잡아먹는다. 모델이 판단하기에 충분한
 *  만큼만 남기고 자른다. */
export function clampToolResult(value: unknown, maxChars: number): unknown {
  const json = JSON.stringify(value);
  if (json.length <= maxChars) return value;
  return {
    truncated: true,
    note: `Result was ${json.length} characters; showing the first ${maxChars}.`,
    preview: json.slice(0, maxChars),
  };
}

export type GeminiRunResult = {
  text: string;
  error?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export async function runBigBrotherGemini(opts: {
  apiKey: string;
  model?: string;
  system: string;
  history: BbMessage[];
  tools: FunctionDeclaration[];
  execute: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** 텍스트 델타를 클라이언트로 흘려보낸다. */
  forward: (text: string) => void;
  maxRounds: number;
  maxHistoryTurns: number;
  maxToolResultChars: number;
  deadline: number;
}): Promise<GeminiRunResult> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const model = opts.model || BIG_BROTHER_MODEL;

  const contents: {
    role: "user" | "model";
    parts: Record<string, unknown>[];
  }[] = toGeminiContents(opts.history, opts.maxHistoryTurns);

  if (contents.length === 0) {
    return { text: "", error: "Nothing to send.", inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }

  let full = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;

  for (let round = 0; round < opts.maxRounds; round++) {
    if (Date.now() >= opts.deadline) {
      return {
        text: full,
        error: full ? undefined : "Big Brother ran out of time before finishing.",
        inputTokens,
        outputTokens,
        totalTokens,
      };
    }

    // 마지막 라운드는 도구를 빼서 반드시 글로 마무리되게 한다.
    const isLast = round === opts.maxRounds - 1;

    let stream;
    try {
      stream = await ai.models.generateContentStream({
        model,
        contents,
        config: {
          systemInstruction: opts.system,
          ...(isLast ? {} : { tools: [{ functionDeclarations: opts.tools }] }),
        },
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return {
        text: full,
        error: geminiErrorMessage(detail),
        inputTokens,
        outputTokens,
        totalTokens,
      };
    }

    const calls: { name: string; args: Record<string, unknown> }[] = [];
    // 모델이 준 파트를 그대로 모은다 — 재구성하면 안 된다.
    // Gemini 3.x 사고 모델은 functionCall 파트에 thoughtSignature 를 붙여 보내고,
    // 다음 요청에 그게 그대로 없으면 400 "Function call is missing a
    // thought_signature" 로 거절한다.
    const modelParts: Record<string, unknown>[] = [];
    let roundText = "";

    try {
      for await (const chunk of stream) {
        const t = chunk.text;
        if (t) {
          roundText += t;
          opts.forward(t);
        }
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          // 화면에 이미 흘린 순수 텍스트는 이력에서 마지막에 한 번만 합친다.
          if (part.functionCall || part.thoughtSignature || part.thought) {
            modelParts.push(part as Record<string, unknown>);
          }
          if (part.functionCall?.name) {
            calls.push({
              name: part.functionCall.name,
              args: (part.functionCall.args ?? {}) as Record<string, unknown>,
            });
          }
        }
        const u = chunk.usageMetadata;
        if (u) {
          inputTokens = u.promptTokenCount ?? inputTokens;
          outputTokens = u.candidatesTokenCount ?? outputTokens;
          totalTokens = u.totalTokenCount ?? totalTokens;
        }
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return {
        text: full + roundText,
        error: full || roundText ? undefined : geminiErrorMessage(detail),
        inputTokens,
        outputTokens,
        totalTokens,
      };
    }

    full += roundText;

    if (calls.length === 0) break;

    // 모델의 도구 호출 턴과 그 결과를 이력에 남기고 한 번 더 돌린다.
    // 파트는 받은 그대로 — thoughtSignature 가 붙어 있어야 다음 요청이 통과한다.
    contents.push({
      role: "model",
      parts: roundText ? [...modelParts, { text: roundText }] : modelParts,
    });
    const parts: Record<string, unknown>[] = [];
    for (const c of calls) {
      const result = await opts.execute(c.name, c.args);
      parts.push({
        functionResponse: {
          name: c.name,
          response: { result: clampToolResult(result, opts.maxToolResultChars) },
        },
      });
    }
    contents.push({ role: "user", parts });
  }

  return { text: full, inputTokens, outputTokens, totalTokens };
}

function geminiErrorMessage(detail: string): string {
  if (/API_KEY|api key|PERMISSION_DENIED/i.test(detail)) {
    return "Big Brother's Gemini API key was rejected.";
  }
  if (/RESOURCE_EXHAUSTED|quota|429/i.test(detail)) {
    return "Gemini quota or rate limit reached — try again shortly.";
  }
  return `Big Brother's Gemini request failed: ${detail.slice(0, 200)}`;
}
