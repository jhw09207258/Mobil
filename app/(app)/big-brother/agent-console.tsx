"use client";

import { useEffect, useRef, useState } from "react";
import { AGENT_MODELS } from "@/lib/antigravity";
import { commandHelp, estimateCost, parseCommand } from "./console-commands";
import { ThinkingIndicator } from "@/components/thinking-indicator";
import {
  addLines,
  cancelRun,
  ensureRun,
  resetSession,
  setLines,
  setModel,
  setPersister,
  startRun,
  useAgentStore,
  type Line,
} from "./agent-store";
import { loadRun, saveRun } from "./run-actions";

// ============================================================================
// Antigravity 콘솔 — Code Space 전체를 이해하는 에이전트와 대화하는 터미널.
//
// 에이전트는 background 로 돌기 때문에 띄운 뒤 폴링한다. 폴링 응답에는 그
// interaction 의 step 이 누적으로 들어오므로, 이미 찍은 개수를 기억해 두고
// 새로 늘어난 것만 출력한다(도구를 실행하면 새 interaction 으로 넘어가며 리셋).
// ============================================================================

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
  // 실행 상태는 React 트리 밖(agent-store)에 있다 — 화면을 옮겨도 계속 돈다.
  const snap = useAgentStore();
  const run = snap.runs[spaceId] ?? null;
  const [input, setInput] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const logRef = useRef<HTMLDivElement>(null);
  const filesTickRef = useRef(snap.filesTick);

  // 서버 기록에서 복원한다(브라우저를 닫았다 와도 이어지도록).
  useEffect(() => {
    let alive = true;
    loadRun(spaceId).then(
      (stored) => {
        if (!alive) return;
        ensureRun(
          spaceId,
          spaceName,
          stored
            ? {
                lines: (stored.lines as Line[]) ?? [],
                interactionId: stored.interactionId ?? undefined,
                environmentId: stored.environmentId ?? undefined,
                model: stored.model ?? undefined,
                turns: stored.turns,
                totalTokens: stored.totalTokens,
                inputTokens: stored.inputTokens,
                outputTokens: stored.outputTokens,
              }
            : undefined
        );
      },
      () => alive && ensureRun(spaceId, spaceName)
    );
    return () => {
      alive = false;
    };
  }, [spaceId, spaceName]);

  // 실행이 끝날 때 스토어가 기록을 남기도록 저장 함수를 연결한다.
  useEffect(() => {
    setPersister((id, r, status) => {
      saveRun({
        spaceId: id,
        lines: r.lines,
        interactionId: r.interactionId,
        environmentId: r.environmentId,
        model: r.model,
        turns: r.turns,
        totalTokens: r.totalTokens,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        status,
      }).catch(() => {});
    });
  }, []);

  // 에이전트가 파일을 고쳤다고 스토어가 알리면 화면을 갱신한다.
  useEffect(() => {
    if (snap.filesTick !== filesTickRef.current) {
      filesTickRef.current = snap.filesTick;
      onFilesChanged();
    }
  }, [snap.filesTick, onFilesChanged]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [run?.lines.length, run?.busy]);

  // 경과 시간 — 시작 시각이 스토어에 있으므로 화면을 다시 열어도 이어진다.
  useEffect(() => {
    if (!run?.busy || !run.startedAt) {
      setElapsed(0);
      return;
    }
    const started = run.startedAt;
    const tick = () => setElapsed(Math.floor((Date.now() - started) / 1000));
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [run?.busy, run?.startedAt]);

  const lines = run?.lines ?? [];
  const busy = run?.busy ?? false;
  const model = run?.model ?? AGENT_MODELS[0];
  const cost = estimateCost(run?.inputTokens ?? 0, run?.outputTokens ?? 0);

  const push = (...next: Line[]) => addLines(spaceId, ...next);

  const showUsage = () => {
    if (!run) return;
    push(
      { kind: "system", text: `model        ${run.model}` },
      { kind: "system", text: `turns        ${run.turns}` },
      { kind: "system", text: `tokens       ${run.totalTokens.toLocaleString()} total` },
      {
        kind: "system",
        text: `             ${run.inputTokens.toLocaleString()} in · ${run.outputTokens.toLocaleString()} out · ${run.thoughtTokens.toLocaleString()} thinking`,
      },
      {
        kind: "system",
        text: `est. cost    $${estimateCost(run.inputTokens, run.outputTokens).toFixed(4)} (tokens only — sandbox compute is free during preview)`,
      },
      {
        kind: "system",
        text: `last run     ${run.lastAt ? new Date(run.lastAt).toLocaleTimeString() : "—"}`,
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
        startRun(spaceId, cmd.text);
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
          setModel(spaceId, cmd.value);
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
        setLines(spaceId, []);
        return;
      case "reset":
        resetSession(spaceId);
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

  return (
    <div className="agent-console">
      <div className="console-log" ref={logRef}>
        {lines.map((l, i) => (
          <div key={i} className={`console-line ${l.kind}`}>
            {l.kind === "input" && <span className="console-prompt">›</span>}
            {/* 본문과 detail 은 세로로 쌓여야 한다 — 형제로 두면 flex row 의
                항목이 되어 옆으로 붙고 상자를 넘친다. */}
            <div className="console-body">
              <span className="console-text">{l.text}</span>
              {l.detail && <div className="console-detail">{l.detail}</div>}
            </div>
          </div>
        ))}
        {busy && (
          <div className="console-line running">
            <ThinkingIndicator label="working" elapsed={elapsed} compact />
            <button className="console-stop" onClick={() => cancelRun(spaceId)}>
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
          onChange={(e) => setModel(spaceId, e.target.value)}
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
        <span>{run?.turns ?? 0} turns</span>
        <span className="sep">|</span>
        <span>
          {(run?.totalTokens ?? 0).toLocaleString()} tok
          {(run?.totalTokens ?? 0) > 0 && ` · $${cost.toFixed(3)}`}
        </span>
        {run?.environmentId && (
          <>
            <span className="sep">|</span>
            <span className="live" title={`Sandbox ${run.environmentId}`}>
              ● sandbox
            </span>
          </>
        )}
      </div>
    </div>
  );
}
