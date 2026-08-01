"use client";

import { IconClose, IconRotate } from "../../icons";
import { fetchJson } from "@/lib/fetch-json";

import { useEffect, useRef, useState } from "react";

type Turn = {
  role: "user" | "model";
  text: string;
  /** 이 턴에서 실제로 파일에 가한 편집 요약. */
  edits?: string[];
};

/**
 * 코드 에이전트 패널 — 대화하면서 모델이 파일을 직접 고친다.
 *
 * 모델이 편집 도구를 부르면 서버가 새 내용을 돌려주고, 여기서 에디터에
 * 반영한다(Yjs 경유 → 공동 편집자 전파 + 자동 저장). 대화 이력은 이 컴포넌트가
 * 들고 매 요청에 함께 보낸다(서버는 상태를 갖지 않는다).
 */
export function AssistPanel({
  getValue,
  applyContent,
  language,
  filename,
  onClose,
}: {
  getValue: () => string;
  applyContent: (next: string) => void;
  language: string;
  filename: string;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    setInput("");
    const next: Turn[] = [...turns, { role: "user", text }];
    setTurns(next);
    setBusy(true);

    try {
      // 세션 만료 시 이 요청은 로그인 페이지 HTML 을 받아 온다 — fetchJson 이
      // 그것을 걸러 "다시 로그인하세요" 로 바꿔 준다(원시 res.json() 은
      // "Unexpected token '<'" 을 사용자에게 그대로 보여 준다).
      const res = await fetchJson<{
        text?: string;
        content?: string;
        changed?: boolean;
        edits?: string[];
      }>("/api/code-agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: next.map((t) => ({ role: t.role, text: t.text })),
          content: getValue(),
          filename,
          language,
        }),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const json = res.data;
      // 파일이 바뀌었으면 즉시 에디터에 반영 — 저장은 기존 자동저장이 처리한다.
      if (json.changed && typeof json.content === "string") applyContent(json.content);
      setTurns((prev) => [
        ...prev,
        { role: "model", text: json.text ?? "", edits: json.edits?.length ? json.edits : undefined },
      ]);
    } catch {
      setError("Could not reach the agent.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="assist-panel">
      <div className="assist-head">
        <span className="label">CODE AGENT</span>
        <div className="row" style={{ gap: 4 }}>
          {turns.length > 0 && (
            <button
              className="assist-close"
              onClick={() => { setTurns([]); setError(null); }}
              title="Clear conversation"
            >
              <IconRotate size={13} />
            </button>
          )}
          <button className="assist-close" onClick={onClose} aria-label="Close">
            <IconClose size={13} />
          </button>
        </div>
      </div>

      <div className="assist-log" ref={scrollRef}>
        {turns.length === 0 && !busy && (
          <p className="assist-hint">
            Ask for a change and it will be applied to this file directly — for
            example “add error handling to the fetch call” or “rename this
            function and update its callers”. Ask a question instead and it will
            just answer.
          </p>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`assist-turn ${t.role}`}>
            <div className="assist-turn-body">{t.text}</div>
            {t.edits && (
              <ul className="assist-edits">
                {t.edits.map((e, j) => (
                  <li key={j}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {busy && <div className="assist-turn model"><div className="assist-turn-body">Working…</div></div>}
      </div>

      {error && <div className="notice notice-error" style={{ margin: 0 }}>{error}</div>}

      <div className="assist-composer">
        <textarea
          className="assist-input"
          rows={2}
          placeholder="Ask for a change…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={busy}
        />
        <button
          className="btn btn-sm btn-primary"
          onClick={send}
          disabled={busy || !input.trim()}
        >
          Send
        </button>
      </div>
    </aside>
  );
}
