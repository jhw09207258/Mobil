"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import "./refresh-button.css";

function RefreshIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 11a8 8 0 1 0-.6 4" />
      <path d="M20 5v6h-6" />
    </svg>
  );
}

/**
 * 서버 컴포넌트가 한 번만 읽어 온 데이터(대시보드 통계, 지연 백분위 등)를
 * 전체 새로고침 없이 다시 불러오는 버튼. `router.refresh()` 는 완료 시점을
 * 알려주지 않아, 회전은 "눌렀다"는 사실만 짧게 보여주고 고정 시간 뒤에
 * 멈춘다 — 실제 재조회 완료와 정확히 맞물리지 않아도 괜찮다(더 오래 걸려도
 * 화면은 데이터가 도착하는 대로 갱신된다).
 */
export function RefreshButton({
  label,
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [spinning, setSpinning] = useState(false);

  const onClick = () => {
    setSpinning(true);
    router.refresh();
    setTimeout(() => setSpinning(false), 600);
  };

  return (
    <button
      type="button"
      className={`btn btn-sm refresh-btn ${className}`}
      onClick={onClick}
      aria-label={label ? undefined : "Refresh"}
    >
      <span className={`refresh-icon ${spinning ? "spinning" : ""}`}>
        <RefreshIcon />
      </span>
      {label && <span>{label}</span>}
    </button>
  );
}
