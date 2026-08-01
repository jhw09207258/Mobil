"use client";

import { useEffect, useRef, useState } from "react";
import "./copy-button.css";

function CopyIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M4 16V5a1 1 0 0 1 1-1h11" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

/**
 * 클립보드 복사 버튼 — 눌리면 잠깐 체크 아이콘으로 바뀌었다가 되돌아온다.
 * 상태/타이머를 자체적으로 들고 있어(호출부는 `content` 문자열 하나만
 * 넘기면 된다) 예전에 install-panel.tsx/copyable.tsx 가 각자 복붙해 두던
 * copy/copied/setTimeout 뭉치를 하나로 모았다.
 */
export function CopyButton({
  content,
  label,
  className = "",
}: {
  content: string;
  /** 아이콘 옆에 보일 글자. 생략하면 아이콘만 있는 버튼이 된다. */
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard 권한 없음 — 조용히 무시 */
    }
  };

  return (
    <button
      type="button"
      className={`btn btn-sm copy-btn ${copied ? "copied" : ""} ${className}`}
      onClick={copy}
      aria-label={label ? undefined : copied ? "Copied" : "Copy"}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {label && <span>{copied ? "Copied" : label}</span>}
    </button>
  );
}
