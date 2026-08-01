"use client";

import { useEffect, useRef, useState } from "react";
import { CopyButton } from "./ui/copy-button";

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
  const [revealed, setRevealed] = useState(!secret);
  // 디코딩 애니메이션 — ●●● 에서 무작위 글자를 거쳐 실제 값으로 수렴한다.
  const [display, setDisplay] = useState<string | null>(null);
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopAnim = () => {
    if (animRef.current) clearInterval(animRef.current);
    animRef.current = null;
  };

  // 언마운트 시 진행 중인 타이머 정리(setState-after-unmount 방지).
  useEffect(() => {
    return () => {
      if (animRef.current) clearInterval(animRef.current);
    };
  }, []);

  const step = Math.max(1, Math.round(value.length / 18));

  const toggleReveal = () => {
    stopAnim();
    if (revealed) {
      // 숨기기 — 오른쪽부터 무작위 글자로 스크램블되며 사라지는 역애니메이션.
      let settledLen = value.length;
      animRef.current = setInterval(() => {
        settledLen -= step;
        if (settledLen <= 0) {
          stopAnim();
          setDisplay(null);
          setRevealed(false);
          return;
        }
        const settled = value.slice(0, settledLen);
        const scrambled = Array.from({ length: value.length - settledLen }, () =>
          SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)]
        ).join("");
        setDisplay(settled + scrambled);
      }, 35);
      return;
    }
    // 보이기 — 왼쪽부터 실제 값으로 수렴하는 디코딩 애니메이션.
    setRevealed(true);
    let progress = 0;
    animRef.current = setInterval(() => {
      progress += step;
      if (progress >= value.length) {
        stopAnim();
        setDisplay(null);
        return;
      }
      const settled = value.slice(0, progress);
      const scrambled = Array.from({ length: value.length - progress }, () =>
        SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)]
      ).join("");
      setDisplay(settled + scrambled);
    }, 35);
  };

  return (
    <div>
      {label && <div className="label" style={{ marginBottom: 6 }}>{label}</div>}
      <div className="row" style={{ gap: 8, alignItems: "stretch" }}>
        <code
          className="code-block grow"
          style={{
            display: "flex",
            alignItems: "center",
            // 마스킹 점(●)에 글자 간격을 주면 실제 값(간격 없음)보다 넓어져
            // 보기/숨기기 전환 때마다 칸 폭이 바뀐다 — 문자 수 기준 고정폭으로
            // 두 상태의 렌더 너비를 맞춘다.
            width: `${Math.min(value.length, 36)}ch`,
          }}
        >
          {revealed ? (
            display ?? value
          ) : (
            <span style={{ color: "var(--text-3)" }}>
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
          <CopyButton content={value} label="Copy" />
        </div>
      </div>
    </div>
  );
}
