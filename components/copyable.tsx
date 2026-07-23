"use client";

import { useRef, useState } from "react";

const SCRAMBLE = "0123456789abcdef-";

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
  // 디코딩 애니메이션 — ●●● 에서 무작위 글자를 거쳐 실제 값으로 수렴한다.
  const [display, setDisplay] = useState<string | null>(null);
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopAnim = () => {
    if (animRef.current) clearInterval(animRef.current);
    animRef.current = null;
  };

  const toggleReveal = () => {
    if (revealed) {
      stopAnim();
      setDisplay(null);
      setRevealed(false);
      return;
    }
    setRevealed(true);
    let progress = 0;
    stopAnim();
    animRef.current = setInterval(() => {
      progress += Math.max(1, Math.round(value.length / 18));
      if (progress >= value.length) {
        stopAnim();
        setDisplay(null); // 완료 — 실제 값 렌더
        return;
      }
      const settled = value.slice(0, progress);
      const scrambled = Array.from({ length: value.length - progress }, () =>
        SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)]
      ).join("");
      setDisplay(settled + scrambled);
    }, 35);
  };

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
          {revealed ? (
            display ?? value
          ) : (
            <span style={{ color: "var(--text-3)", letterSpacing: 2 }}>
              {"●".repeat(Math.min(value.length, 36))}
            </span>
          )}
        </code>
        <div className="stack" style={{ gap: 6, justifyContent: "center" }}>
          {secret && (
            <button type="button" className="btn btn-sm" onClick={toggleReveal}>
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
