"use client";

import { useSyncExternalStore } from "react";
import { AGENT_MODELS, type AgentStep } from "@/lib/antigravity";

// ============================================================================
// Agent 실행 상태 — React 트리 밖의 모듈 싱글톤.
//
// 콘솔을 컴포넌트 상태로 들고 있으면 화면을 옮기는 순간(탭 전환, 다른 페이지)
// 언마운트되면서 진행 중이던 실행과 대화가 통째로 사라진다. 업로드/임포트와
// 같은 방식으로 트리 밖에 두어, 어디를 돌아다녀도 폴링이 계속되고 돌아오면
// 그대로 이어진다. 완료되면 전역 토스트로 알린다.
//
// 브라우저를 아예 닫으면 폴링은 멈춘다 — 그 경우를 위해 서버에도 기록을
// 남겨두고(agent_runs), 다시 들어오면 거기서 복원한다.
// ============================================================================

const POLL_MS = 1500;
const MAX_POLLS = 400; // 약 10분

export type Line = {
  kind: "input" | "text" | "thought" | "shell" | "edit" | "search" | "tool" | "error" | "system";
  text: string;
  detail?: string;
};

export type RunState = {
  spaceId: string;
  spaceName: string;
  lines: Line[];
  busy: boolean;
  /** 실행 시작 시각(ms) — 경과 표시는 화면에서 계산한다. */
  startedAt: number | null;
  model: string;
  interactionId?: string;
  environmentId?: string;
  turns: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  lastAt?: number;
};

export type Notice = {
  id: number;
  spaceId: string;
  spaceName: string;
  ok: boolean;
  summary: string;
};

type Snapshot = {
  runs: Record<string, RunState>;
  notices: Notice[];
  /** 화면이 파일 목록을 다시 읽어야 할 때 증가. */
  filesTick: number;
};

const EMPTY: Snapshot = { runs: {}, notices: [], filesTick: 0 };

let snapshot: Snapshot = EMPTY;
const listeners = new Set<() => void>();
let noticeSeq = 0;
/** 진행 중인 실행 수 — 창을 닫으려 할 때 경고할지 판단. */
let activeCount = 0;

function commit(next: Snapshot) {
  snapshot = next;
  listeners.forEach((l) => l());
}

function patchRun(spaceId: string, next: Partial<RunState>) {
  const cur = snapshot.runs[spaceId];
  if (!cur) return;
  commit({ ...snapshot, runs: { ...snapshot.runs, [spaceId]: { ...cur, ...next } } });
}

function pushLines(spaceId: string, ...lines: Line[]) {
  const cur = snapshot.runs[spaceId];
  if (!cur) return;
  commit({
    ...snapshot,
    runs: { ...snapshot.runs, [spaceId]: { ...cur, lines: [...cur.lines, ...lines] } },
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => EMPTY;

export function useAgentStore() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useRun(spaceId: string | null): RunState | null {
  const snap = useAgentStore();
  return spaceId ? snap.runs[spaceId] ?? null : null;
}

/** 화면이 처음 붙을 때 — 이미 실행 중이면 그 상태를 그대로 쓴다. */
export function ensureRun(spaceId: string, spaceName: string, restored?: Partial<RunState>) {
  if (snapshot.runs[spaceId]) return;
  commit({
    ...snapshot,
    runs: {
      ...snapshot.runs,
      [spaceId]: {
        spaceId,
        spaceName,
        lines: [
          { kind: "system", text: `Antigravity agent ready — ${spaceName}` },
          { kind: "system", text: "Describe what you want built or changed. /help for commands." },
        ],
        busy: false,
        startedAt: null,
        model: AGENT_MODELS[0],
        turns: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        thoughtTokens: 0,
        ...restored,
      },
    },
  });
}

export function setLines(spaceId: string, lines: Line[]) {
  patchRun(spaceId, { lines });
}
export function addLines(spaceId: string, ...lines: Line[]) {
  pushLines(spaceId, ...lines);
}
export function setModel(spaceId: string, model: string) {
  patchRun(spaceId, { model });
}
export function resetSession(spaceId: string) {
  patchRun(spaceId, {
    interactionId: undefined,
    environmentId: undefined,
    turns: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    thoughtTokens: 0,
  });
}

export function dismissNotice(id: number) {
  commit({ ...snapshot, notices: snapshot.notices.filter((n) => n.id !== id) });
}

function notify(spaceId: string, spaceName: string, ok: boolean, summary: string) {
  commit({
    ...snapshot,
    notices: [...snapshot.notices, { id: ++noticeSeq, spaceId, spaceName, ok, summary }],
  });
}

const STEP_PREFIX: Record<AgentStep["kind"], string> = {
  thought: "·",
  shell: "$",
  edit: "~",
  search: "?",
  text: " ",
  tool: "*",
};

const cancelled = new Set<string>();
export function cancelRun(spaceId: string) {
  cancelled.add(spaceId);
}

/** 서버에 진행 상황을 남긴다 — 브라우저를 닫아도 기록이 남고 복원된다. */
type Persist = (spaceId: string, run: RunState, status: string) => void;
let persist: Persist = () => {};
export function setPersister(fn: Persist) {
  persist = fn;
}

async function call(spaceId: string, model: string, payload: Record<string, unknown>) {
  const res = await fetch("/api/antigravity", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ spaceId, model, ...payload }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

/**
 * 한 턴을 끝까지 돌린다. 컴포넌트가 사라져도 이 함수는 계속 돈다 —
 * 상태를 트리 밖 스토어에 쓰기 때문이다.
 */
export async function startRun(spaceId: string, text: string) {
  const run = snapshot.runs[spaceId];
  if (!run || run.busy) return;

  cancelled.delete(spaceId);
  activeCount++;
  patchRun(spaceId, { busy: true, startedAt: Date.now() });
  pushLines(spaceId, { kind: "input", text });

  let committedAny = false;
  let summary = "";
  let ok = true;

  try {
    const started = await call(spaceId, run.model, {
      action: "start",
      input: text,
      previousInteractionId: run.interactionId,
      environmentId: run.environmentId,
    });

    if (typeof started.mountedCount === "number" && !run.environmentId) {
      pushLines(spaceId, {
        kind: "system",
        text: `Mounted ${started.mountedCount} file(s) into the sandbox at /workspace`,
      });
      if (started.skipped?.length) {
        pushLines(spaceId, {
          kind: "system",
          text: `${started.skipped.length} file(s) too large to mount: ${started.skipped
            .slice(0, 5)
            .join(", ")}`,
        });
      }
    }

    let id: string = started.interactionId;
    let env: string | undefined = started.environmentId ?? run.environmentId;
    let printedId = "";
    let printedCount = 0;
    const totals = { total: 0, input: 0, output: 0, thought: 0 };

    for (let i = 0; i < MAX_POLLS; i++) {
      if (cancelled.has(spaceId)) {
        pushLines(spaceId, { kind: "system", text: "Stopped." });
        summary = "Stopped";
        break;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
      const p = await call(spaceId, run.model, {
        action: "poll",
        interactionId: id,
        environmentId: env,
      });

      const steps: AgentStep[] = p.steps ?? [];
      const fresh = steps.slice(printedId === id ? printedCount : 0);
      if (fresh.length) {
        pushLines(
          spaceId,
          ...fresh.map((s) => ({
            kind: s.kind as Line["kind"],
            text: `${STEP_PREFIX[s.kind]} ${s.label}`,
            detail: s.detail,
          }))
        );
      }
      printedId = id;
      printedCount = steps.length;

      if (p.committed?.length) {
        committedAny = true;
        pushLines(spaceId, {
          kind: "edit",
          text: `saved ${p.committed.length} file(s)`,
          detail: p.committed.join("\n"),
        });
      }
      if (p.deleted?.length) {
        committedAny = true;
        pushLines(spaceId, {
          kind: "edit",
          text: `deleted ${p.deleted.length} file(s)`,
          detail: p.deleted.join("\n"),
        });
      }

      totals.total += p.totalTokens ?? 0;
      totals.input += p.inputTokens ?? 0;
      totals.output += p.outputTokens ?? 0;
      totals.thought += p.thoughtTokens ?? 0;

      if (p.status === "failed") {
        pushLines(spaceId, { kind: "error", text: `Agent run ${p.rawStatus}.` });
        summary = `Run ${p.rawStatus}`;
        ok = false;
        break;
      }
      if (p.status === "done") {
        if (p.text) pushLines(spaceId, { kind: "text", text: p.text });
        if (p.rawStatus === "budget_exceeded") {
          pushLines(spaceId, { kind: "error", text: "Token budget for this run was exhausted." });
        }
        summary = p.text ? String(p.text).slice(0, 90) : "Finished";
        break;
      }

      if (p.interactionId !== id) {
        id = p.interactionId;
        printedCount = 0;
      }
      env = p.environmentId ?? env;
    }

    const cur = snapshot.runs[spaceId];
    patchRun(spaceId, {
      interactionId: id,
      environmentId: env,
      turns: (cur?.turns ?? 0) + 1,
      totalTokens: (cur?.totalTokens ?? 0) + totals.total,
      inputTokens: (cur?.inputTokens ?? 0) + totals.input,
      outputTokens: (cur?.outputTokens ?? 0) + totals.output,
      thoughtTokens: (cur?.thoughtTokens ?? 0) + totals.thought,
      lastAt: Date.now(),
    });
  } catch (e) {
    ok = false;
    summary = e instanceof Error ? e.message : "The agent request failed.";
    pushLines(spaceId, { kind: "error", text: summary });
  } finally {
    activeCount--;
    patchRun(spaceId, { busy: false, startedAt: null });
    const finished = snapshot.runs[spaceId];
    if (finished) {
      notify(spaceId, finished.spaceName, ok, summary || "Finished");
      persist(spaceId, finished, ok ? "done" : "failed");
    }
    if (committedAny) commit({ ...snapshot, filesTick: snapshot.filesTick + 1 });
  }
}

/** 진행 중인 실행이 있으면 창을 닫기 전에 경고한다. */
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (activeCount > 0) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}
