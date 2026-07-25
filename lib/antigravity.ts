import { GoogleGenAI } from "@google/genai";

// ============================================================================
// Antigravity 에이전트 — Gemini Interactions API 로 Code Space 전체를 다룬다.
//
// 단일 파일만 보던 /api/code-agent 와 달리, 여기서는 Code Space 의 모든 파일을
// 원격 샌드박스(/workspace)에 통째로 마운트한다. 에이전트는 거기서 파일을 읽고
// 고치고 grep 하고 bash 를 돌릴 수 있다 — VS Code 안의 Antigravity 와 같은 방식.
//
// ※ 2026년 I/O 이후 Antigravity 는 Interactions API 로 정식 공개됐다. 인증은
//   일반 GEMINI_API_KEY 를 그대로 쓴다. IDE 를 리버스 엔지니어링하는 것이
//   아니라 문서화된 공개 API 를 쓰는 것이므로 약관 위반이 아니다.
//
// 샌드박스는 휘발성이라 파일을 되가져올 방법이 없다. 그래서 에이전트가 편집을
// 저장하려면 반드시 commit_files 를 부르게 한다(시스템 지시로 강제).
// ============================================================================

export const ANTIGRAVITY_AGENT = "antigravity-preview-05-2026";

/** 고를 수 있는 추론 모델. 기본값이 맨 앞. */
export const AGENT_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
] as const;

/** 샌드박스에 올릴 총량 상한 — 초과하면 큰 파일부터 잘라낸다. */
export const MAX_MOUNT_BYTES = 1_500_000;
/** 도구 호출 왕복 상한. 무한 루프와 요금 폭주를 막는다. */
export const MAX_TOOL_ROUNDS = 12;

const SYSTEM = `You are the coding agent inside Possion, working on a Code Space
that is mounted at /workspace.

You have a real sandbox: read, edit, search files, and run shell commands there.
Explore before you change things — read the files you are about to touch and
follow the conventions already in the codebase.

CRITICAL — saving your work:
The sandbox is discarded when this session ends. Editing a file in /workspace
does NOT save it. To persist anything you MUST call commit_files with the full
final content of every file you created or modified. Call it once at the end of
your work, listing every changed file. If you do not call it, the user loses
everything you did. Use delete_files for files you removed.

Paths in commit_files/delete_files must be relative to /workspace (e.g.
"src/app.ts", not "/workspace/src/app.ts").

Be concise in your replies. Describe what you changed and why, not how the
tools work.`;

export const AGENT_TOOLS = [
  {
    type: "function" as const,
    name: "commit_files",
    description:
      "Persist files to the user's Code Space. Required for any change to survive — the sandbox is discarded otherwise. Pass the COMPLETE final content of each file.",
    parameters: {
      type: "object",
      properties: {
        files: {
          type: "array",
          description: "Every file you created or modified.",
          items: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Path relative to /workspace, e.g. src/index.ts",
              },
              content: { type: "string", description: "Complete file contents." },
            },
            required: ["path", "content"],
          },
        },
      },
      required: ["files"],
    },
  },
  {
    type: "function" as const,
    name: "delete_files",
    description: "Remove files from the user's Code Space.",
    parameters: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          description: "Paths relative to /workspace.",
          items: { type: "string" },
        },
      },
      required: ["paths"],
    },
  },
];

export type MountFile = { path: string; content: string };

/**
 * 파일 목록을 샌드박스 마운트용 inline source 로 바꾼다.
 * 총량이 상한을 넘으면 큰 파일부터 버리고, 버린 목록을 함께 돌려준다
 * (에이전트에게 "이건 안 올라갔다"고 알려주기 위해).
 */
export function buildSources(files: MountFile[]): {
  sources: { type: "inline"; content: string; target: string }[];
  skipped: string[];
} {
  // 작은 파일이 먼저 들어가도록 크기 오름차순 — 파일 수를 최대한 살린다.
  const ordered = [...files].sort((a, b) => a.content.length - b.content.length);
  const sources: { type: "inline"; content: string; target: string }[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const f of ordered) {
    const size = f.content.length;
    if (total + size > MAX_MOUNT_BYTES) {
      skipped.push(f.path);
      continue;
    }
    total += size;
    sources.push({ type: "inline", content: f.content, target: f.path });
  }
  return { sources, skipped };
}

export type AgentStep = {
  kind: "thought" | "shell" | "edit" | "search" | "text" | "tool";
  label: string;
  detail?: string;
};

type RawStep = {
  type?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  text?: string;
  content?: unknown;
  [k: string]: unknown;
};

/** 원시 step 을 터미널 한 줄로 요약한다. UI 가 그대로 찍는다. */
export function summarizeStep(step: RawStep): AgentStep | null {
  const t = step.type ?? "";
  if (t === "thought") {
    const text = typeof step.text === "string" ? step.text : "";
    return text ? { kind: "thought", label: text.slice(0, 400) } : null;
  }
  if (t === "code_execution_call") {
    const code = typeof step.code === "string" ? step.code : "";
    return { kind: "shell", label: code.split("\n")[0].slice(0, 200) || "run", detail: code };
  }
  if (t === "google_search_call") {
    const q = step.arguments?.query;
    return { kind: "search", label: typeof q === "string" ? q : "web search" };
  }
  if (t === "url_context_call") {
    const u = step.arguments?.url;
    return { kind: "search", label: typeof u === "string" ? u : "fetch url" };
  }
  if (t === "function_call") {
    const name = step.name ?? "tool";
    const args = step.arguments ?? {};
    if (name === "commit_files") {
      const files = Array.isArray(args.files) ? args.files : [];
      return {
        kind: "edit",
        label: `commit ${files.length} file(s)`,
        detail: files
          .map((f) => (f && typeof f === "object" ? String((f as MountFile).path) : ""))
          .filter(Boolean)
          .join("\n"),
      };
    }
    if (name === "delete_files") {
      const paths = Array.isArray(args.paths) ? args.paths : [];
      return { kind: "edit", label: `delete ${paths.length} file(s)`, detail: paths.join("\n") };
    }
    return { kind: "tool", label: name };
  }
  return null;
}

export type CommitHandlers = {
  commit: (files: MountFile[]) => Promise<{ saved: string[]; failed: string[] }>;
  remove: (paths: string[]) => Promise<{ deleted: string[] }>;
};

/** 에이전트 실행은 몇 분이 걸릴 수 있다. 서버리스 함수 타임아웃에 걸리지 않도록
 *  background 로 띄우고 폴링한다 — 요청 하나하나는 짧게 끝난다. */
const BASE = (model: string) => ({
  agent: ANTIGRAVITY_AGENT,
  tools: AGENT_TOOLS,
  system_instruction: SYSTEM,
  agent_config: { type: "antigravity" as const, model },
  store: true,
  background: true,
});

export type StartedTurn = {
  interactionId: string;
  environmentId?: string;
  status: string;
};

/** 턴을 띄우기만 하고 즉시 반환한다. */
export async function startTurn(opts: {
  apiKey: string;
  input: string;
  model: string;
  /** 첫 턴이면 마운트할 파일들, 이어가는 턴이면 생략. */
  sources?: { type: "inline"; content: string; target: string }[];
  previousInteractionId?: string;
  environmentId?: string;
}): Promise<StartedTurn> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const res = await ai.interactions.create({
    ...BASE(opts.model),
    environment: opts.environmentId
      ? opts.environmentId
      : { type: "remote" as const, sources: opts.sources ?? [] },
    ...(opts.previousInteractionId
      ? { previous_interaction_id: opts.previousInteractionId }
      : {}),
    input: opts.input,
  });
  return {
    interactionId: res.id,
    environmentId: res.environment_id,
    status: res.status,
  };
}

export type PolledTurn = {
  /** 이어서 폴링할 대상. 도구를 실행하면 새 interaction 으로 넘어간다. */
  interactionId: string;
  environmentId?: string;
  /** running 이면 클라이언트가 계속 폴링한다. */
  status: "running" | "done" | "failed";
  rawStatus: string;
  text: string;
  steps: AgentStep[];
  committed: string[];
  deleted: string[];
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
};

/**
 * 한 번 폴링한다. 에이전트가 도구를 기다리고 있으면 여기서 실행하고 다음
 * interaction 을 띄운 뒤 그 ID 를 돌려준다.
 */
export async function pollTurn(opts: {
  apiKey: string;
  interactionId: string;
  model: string;
  environmentId?: string;
  handlers: CommitHandlers;
}): Promise<PolledTurn> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const res = await ai.interactions.get(opts.interactionId);

  const steps: AgentStep[] = [];
  for (const s of res.steps ?? []) {
    const line = summarizeStep(s as RawStep);
    if (line) steps.push(line);
  }
  const u = res.usage;
  const usage = {
    totalTokens: u?.total_tokens ?? 0,
    inputTokens: u?.total_input_tokens ?? 0,
    outputTokens: u?.total_output_tokens ?? 0,
    thoughtTokens: u?.total_thought_tokens ?? 0,
  };
  const committed: string[] = [];
  const deleted: string[] = [];

  if (res.status === "requires_action") {
    const calls = (res.steps ?? []).filter(
      (s): s is typeof s & { id: string; name: string } =>
        (s as RawStep).type === "function_call"
    );
    if (calls.length > 0) {
      const results = [];
      for (const call of calls) {
        const args = ((call as RawStep).arguments ?? {}) as Record<string, unknown>;
        let result: Record<string, unknown>;
        if (call.name === "commit_files") {
          const files = (Array.isArray(args.files) ? args.files : []).filter(
            (f): f is MountFile =>
              !!f && typeof f === "object" && typeof (f as MountFile).path === "string"
          );
          const out = await opts.handlers.commit(files);
          committed.push(...out.saved);
          result = out.failed.length
            ? {
                ok: false,
                saved: out.saved,
                failed: out.failed,
                error: "Some files could not be saved.",
              }
            : { ok: true, saved: out.saved, message: `Saved ${out.saved.length} file(s).` };
        } else if (call.name === "delete_files") {
          const paths = (Array.isArray(args.paths) ? args.paths : []).filter(
            (p): p is string => typeof p === "string"
          );
          const out = await opts.handlers.remove(paths);
          deleted.push(...out.deleted);
          result = { ok: true, deleted: out.deleted };
        } else {
          result = { ok: false, error: `Unknown tool ${call.name}` };
        }
        results.push({
          type: "function_result" as const,
          call_id: call.id,
          name: call.name,
          result,
        });
      }
      // environment 는 필수 필드다 — 빈 문자열을 보내면 400 이 난다. 여기까지
      // 왔는데 환경 ID 가 없으면 이어갈 곳이 없으므로 분명하게 실패시킨다.
      const envId = res.environment_id ?? opts.environmentId;
      if (!envId) {
        throw new Error(
          "The sandbox environment was lost — start a new agent session with /reset."
        );
      }
      const next = await ai.interactions.create({
        ...BASE(opts.model),
        environment: envId,
        previous_interaction_id: res.id,
        input: results,
      });
      return {
        interactionId: next.id,
        environmentId: next.environment_id ?? res.environment_id,
        status: "running",
        rawStatus: res.status,
        text: "",
        steps,
        committed,
        deleted,
        ...usage,
      };
    }
  }

  const terminal =
    res.status === "completed" ||
    res.status === "incomplete" ||
    res.status === "budget_exceeded";
  const failed =
    res.status === "failed" || res.status === "cancelled";

  return {
    interactionId: res.id,
    environmentId: res.environment_id ?? opts.environmentId,
    status: failed ? "failed" : terminal ? "done" : "running",
    rawStatus: res.status,
    text: res.output_text ?? "",
    steps,
    committed,
    deleted,
    ...usage,
  };
}
