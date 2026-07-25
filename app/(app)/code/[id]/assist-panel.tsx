"use client";

import { useState } from "react";

type Action = "explain" | "refactor" | "fix" | "tests";

const ACTION_LABEL: Record<Action, string> = {
  explain: "Explain",
  refactor: "Refactor",
  fix: "Find bugs",
  tests: "Write tests",
};

/**
 * 코드 어시스트 패널 — 선택 영역(없으면 파일 전체)을 Claude 에 보내 설명/리팩터/
 * 버그 찾기/테스트 작성을 요청한다. 응답은 그대로 보여주기만 하고 파일에
 * 자동 반영하지 않는다 — 편집 중인 코드를 모델이 말없이 덮어쓰지 않게 하기 위함.
 */
export function AssistPanel({
  getSelection,
  language,
  filename,
  onClose,
}: {
  getSelection: () => string;
  language: string;
  filename: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<Action | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: Action) => {
    const code = getSelection();
    if (!code.trim()) {
      setError("Nothing to send — the file is empty.");
      return;
    }
    setBusy(action);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/code-assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, code, language, filename }),
      });
      const json = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) setError(json.error || `Request failed (${res.status}).`);
      else setResult(json.text ?? "");
    } catch {
      setError("Could not reach the assistant.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside className="assist-panel">
      <div className="assist-head">
        <span className="label">CODE ASSIST</span>
        <button className="assist-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="assist-actions">
        {(Object.keys(ACTION_LABEL) as Action[]).map((a) => (
          <button
            key={a}
            className="btn btn-sm"
            onClick={() => run(a)}
            disabled={busy !== null}
          >
            {busy === a ? "Working…" : ACTION_LABEL[a]}
          </button>
        ))}
      </div>
      <p className="assist-hint">
        Uses your selection, or the whole file when nothing is selected. Results are
        shown here only — your file is never changed automatically.
      </p>

      {error && <div className="notice notice-error">{error}</div>}
      {result && <div className="assist-result">{result}</div>}
    </aside>
  );
}
