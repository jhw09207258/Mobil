"use client";

import { useState } from "react";

export function Copyable({
  value,
  label,
  secret = false,
}: {
  value: string;
  label?: string;
  /** true 면 값을 ●●● 마스킹으로 숨기고, View ID 버튼을 눌렀을 때만 보여준다. */
  secret?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(!secret);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard 권한 없음 — 조용히 무시 */
    }
  };

  return (
    <div>
      {label && <div className="label" style={{ marginBottom: 6 }}>{label}</div>}
      <div className="row" style={{ gap: 8, alignItems: "stretch" }}>
        <code className="code-block grow" style={{ display: "flex", alignItems: "center" }}>
          {revealed ? value : "●".repeat(Math.min(value.length, 36))}
        </code>
        <div className="stack" style={{ gap: 6, justifyContent: "center" }}>
          {secret && (
            <button type="button" className="btn btn-sm" onClick={() => setRevealed((v) => !v)}>
              {revealed ? "Hide ID" : "View ID"}
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
