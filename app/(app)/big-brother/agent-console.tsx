"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AGENT_MODELS, type AgentStep } from "@/lib/antigravity";
import { commandHelp, estimateCost, parseCommand } from "./console-commands";

// ============================================================================
// Antigravity 콘솔 — Code Space 전체를 이해하는 에이전트와 대화하는 터미널.
//
// 에이전트는 background 로 돌기 때문에 띄운 뒤 폴링한다. 폴링 응답에는 그
// interaction 의 step 이 누적으로 들어오므로, 이미 찍은 개수를 기억해 두고
// 새로 늘어난 것만 출력한다(도구를 실행하면 새 interaction 으로 넘어가며 리셋).
// ============================================================================

const POLL_MS = 1500;
const MAX_POLLS = 400; // 약 10분

export type Line = {
  kind: "input" | "text" | "thought" | "shell" | "edit" | "search" | "tool" | "error" | "system";
  text: string;
  detail?: string;
};

export type Session = {
  interactionId?: string;
  environmentId?: string;
  turns: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  lastAt?: number;
};

const EMPTY: Session = {
  turns: 0,
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  thoughtTokens: 0,
};

const STEP_PREFIX: Record<AgentStep["kind"], string> = {
  thought: "·",
  shell: "$",
  edit: "✎",
  search: "⌕",
  text: " ",
  tool: "⚙",
};

export function AgentConsole({
  spaceId,
  spaceName,
  files,
  onOpenFile,
  onFilesChanged,
  onGithub,
  onDeploy,
}: {
  spaceId: string;
  spaceName: string;
  files: { path: string }[];
  /** 에디터가 있는 화면에서만 준다 — Big Brother 에는 편집 창이 없다. */
  onOpenFile?: (path: string) => void;
  onFilesChanged: () => void;
  onGithub?: () => void;
  onDeploy?: () => void;
}) {
  const [lines, setLines] = useState<Line[]>([
    { kind: "system", text: `Antigravity agent ready — ${spaceName}` },
    { kind: "system", text: "Describe what you want built or changed. /help for commands." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [model, setModel] = useState<string>(AGENT_MODELS[0]);
  const [session, setSession] = useState<Session>(EMPTY);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);

  const logRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const push = useCallback((...next: Line[]) => {
    setLines((prev) => [...prev, ...next]);
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines, busy]);

  // 실행 중 경과 시간 — 몇 분씩 걸릴 수 있어 멈춘 것처럼 보이면 안 된다.
  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(timer);
  }, [busy]);

  const call = async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/antigravity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spaceId, model, ...payload }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  };

  const run = async (text: string) => {
    setBusy(true);
    cancelRef.current = false;
    let committedAny = false;

    try {
      const prev = sessionRef.current;
      const started = await call({
        action: "start",
        input: text,
        previousInteractionId: prev.interactionId,
        environmentId: prev.environmentId,
      });

      if (typeof started.mountedCount === "number" && !prev.environmentId) {
        push({
          kind: "system",
          text: `Mounted ${started.mountedCount} file(s) into the sandbox at /workspace`,
        });
        if (started.skipped?.length) {
          push({
            kind: "system",
            text: `${started.skipped.length} file(s) too large to mount: ${started.skipped
              .slice(0, 5)
              .join(", ")}`,
          });
        }
      }

      let id: string = started.interactionId;
      let env: string | undefined = started.environmentId ?? prev.environmentId;
      let printedId = "";
      let printedCount = 0;
      const totals = { total: 0, input: 0, output: 0, thought: 0 };

      for (let i = 0; i < MAX_POLLS; i++) {
        if (cancelRef.current) {
          push({ kind: "system", text: "Stopped." });
          break;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
        const p = await call({
          action: "poll",
          interactionId: id,
          environmentId: env,
        });

        // interaction 이 바뀌면 step 카운터를 리셋한다.
        if (p.interactionId !== printedId) {
          if (p.interactionId !== id) printedCount = 0;
        }
        const steps: AgentStep[] = p.steps ?? [];
        const fresh = steps.slice(printedId === id ? printedCount : 0);
        if (fresh.length) {
          push(
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
          push({
            kind: "edit",
            text: `saved ${p.committed.length} file(s)`,
            detail: p.committed.join("\n"),
          });
        }
        if (p.deleted?.length) {
          committedAny = true;
          push({ kind: "edit", text: `deleted ${p.deleted.length} file(s)`, detail: p.deleted.join("\n") });
        }

        totals.total += p.totalTokens ?? 0;
        totals.input += p.inputTokens ?? 0;
        totals.output += p.outputTokens ?? 0;
        totals.thought += p.thoughtTokens ?? 0;

        if (p.status === "failed") {
          push({ kind: "error", text: `Agent run ${p.rawStatus}.` });
          break;
        }
        if (p.status === "done") {
          if (p.text) push({ kind: "text", text: p.text });
          if (p.rawStatus === "budget_exceeded") {
            push({ kind: "error", text: "Token budget for this run was exhausted." });
          }
          break;
        }

        // 도구를 실행했으면 다음 interaction 으로 넘어간다.
        if (p.interactionId !== id) {
          id = p.interactionId;
          printedCount = 0;
        }
        env = p.environmentId ?? env;
      }

      setSession((s) => ({
        interactionId: id,
        environmentId: env,
        turns: s.turns + 1,
        totalTokens: s.totalTokens + totals.total,
        inputTokens: s.inputTokens + totals.input,
        outputTokens: s.outputTokens + totals.output,
        thoughtTokens: s.thoughtTokens + totals.thought,
        lastAt: Date.now(),
      }));
      if (committedAny) onFilesChanged();
    } catch (e) {
      push({ kind: "error", text: e instanceof Error ? e.message : "The agent request failed." });
    } finally {
      setBusy(false);
    }
  };

  const showUsage = () => {
    const s = sessionRef.current;
    const cost = estimateCost(s.inputTokens, s.outputTokens);
    push(
      { kind: "system", text: `model        ${model}` },
      { kind: "system", text: `turns        ${s.turns}` },
      { kind: "system", text: `tokens       ${s.totalTokens.toLocaleString()} total` },
      {
        kind: "system",
        text: `             ${s.inputTokens.toLocaleString()} in · ${s.outputTokens.toLocaleString()} out · ${s.thoughtTokens.toLocaleString()} thinking`,
      },
      { kind: "system", text: `est. cost    $${cost.toFixed(4)} (tokens only — sandbox compute is free during preview)` },
      {
        kind: "system",
        text: `last run     ${s.lastAt ? new Date(s.lastAt).toLocaleTimeString() : "—"}`,
      },
      {
        kind: "system",
        text: "Google does not expose remaining quota through the API — check aistudio.google.com for your plan's limits.",
      }
    );
  };

  const submit = () => {
    const raw = input;
    const cmd = parseCommand(raw, AGENT_MODELS);
    if (!cmd) return;
    setInput("");
    setHistory((h) => [raw.trim(), ...h].slice(0, 50));
    setHistIdx(-1);

    if (cmd.type !== "send") push({ kind: "input", text: raw.trim() });

    switch (cmd.type) {
      case "send":
        if (busy) return;
        push({ kind: "input", text: cmd.text });
        run(cmd.text);
        return;
      case "help":
        push(
          ...commandHelp(AGENT_MODELS).map(([c, d]) => ({
            kind: "system" as const,
            text: `${c.padEnd(16)} ${d}`,
          })),
          {
            kind: "system",
            text: "Anything else is sent to the agent, which can edit files across the whole Code Space.",
          }
        );
        return;
      case "files":
        push(
          files.length === 0
            ? { kind: "system", text: "This Code Space is empty — ask the agent to create files." }
            : { kind: "system", text: `${files.length} file(s):` },
          ...files.map((f) => ({ kind: "system" as const, text: `  ${f.path}` }))
        );
        return;
      case "open": {
        const hit =
          files.find((f) => f.path === cmd.path) ||
          files.find((f) => f.path.endsWith(`/${cmd.path}`)) ||
          files.find((f) => f.path.includes(cmd.path));
        if (!hit) push({ kind: "error", text: `No file matching "${cmd.path}".` });
        else if (onOpenFile) {
          onOpenFile(hit.path);
          push({ kind: "system", text: `Opened ${hit.path}` });
        } else {
          push({
            kind: "system",
            text: `${hit.path} — open it in Codespace to edit (this console has no editor).`,
          });
        }
        return;
      }
      case "model":
        if (cmd.value) {
          setModel(cmd.value);
          push({ kind: "system", text: `Model set to ${cmd.value}.` });
        } else {
          push(
            { kind: "system", text: `Current model: ${model}` },
            { kind: "system", text: `Available: ${AGENT_MODELS.join(", ")}` }
          );
        }
        return;
      case "usage":
        showUsage();
        return;
      case "clear":
        setLines([]);
        return;
      case "reset":
        setSession(EMPTY);
        push({
          kind: "system",
          text: "Agent session reset — the next message remounts the Code Space in a fresh sandbox.",
        });
        return;
      case "github":
        if (onGithub) onGithub();
        else push({ kind: "system", text: "Open this Code Space in Codespace to push to GitHub." });
        return;
      case "deploy":
        if (onDeploy) onDeploy();
        else push({ kind: "system", text: "Open this Code Space in Codespace to deploy." });
        return;
      case "error":
        push({ kind: "error", text: cmd.message });
        return;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }
    // 위/아래로 이전 입력 불러오기 — 터미널이니까.
    if (e.key === "ArrowUp" && !input.includes("\n")) {
      const next = Math.min(histIdx + 1, history.length - 1);
      if (next >= 0) {
        e.preventDefault();
        setHistIdx(next);
        setInput(history[next]);
      }
    } else if (e.key === "ArrowDown" && histIdx >= 0) {
      e.preventDefault();
      const next = histIdx - 1;
      setHistIdx(next);
      setInput(next < 0 ? "" : history[next]);
    }
  };

  const cost = estimateCost(session.inputTokens, session.outputTokens);

  return (
    <div className="agent-console">
      <div className="console-log" ref={logRef}>
        {lines.map((l, i) => (
          <div key={i} className={`console-line ${l.kind}`}>
            {l.kind === "input" && <span className="console-prompt">›</span>}
            <span className="console-text">{l.text}</span>
            {l.detail && <div className="console-detail">{l.detail}</div>}
          </div>
        ))}
        {busy && (
          <div className="console-line running">
            <span className="console-cursor" />
            <span>working… {elapsed}s</span>
            <button className="console-stop" onClick={() => (cancelRef.current = true)}>
              stop
            </button>
          </div>
        )}
      </div>

      <div className="console-input-row">
        <span className="console-prompt">›</span>
        <textarea
          className="console-input"
          rows={1}
          placeholder={busy ? "" : "Describe what to build or change — /help for commands"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoFocus
        />
      </div>

      {/* 상태 표시줄 — 모델·토큰·비용·샌드박스를 항상 보이게 */}
      <div className="console-status">
        <select
          className="console-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={busy}
          title="Reasoning model"
        >
          {AGENT_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <span className="sep">|</span>
        <span>{spaceName}</span>
        <span className="sep">|</span>
        <span>{files.length} files</span>
        <span className="sep">|</span>
        <span>{session.turns} turns</span>
        <span className="sep">|</span>
        <span>
          {session.totalTokens.toLocaleString()} tok
          {session.totalTokens > 0 && ` · $${cost.toFixed(3)}`}
        </span>
        {session.environmentId && (
          <>
            <span className="sep">|</span>
            <span className="live" title={`Sandbox ${session.environmentId}`}>
              ● sandbox
            </span>
          </>
        )}
      </div>
    </div>
  );
}
