"use client";

import { ParticleFlow } from "./particle-flow";

/**
 * Big Brother 가 생각/작업 중이라는 표시.
 *
 * 예전에는 빈 말풍선만 떠 있어서 멈춘 건지 도는 건지 알 수 없었다. 로그인
 * 화면과 같은 벡터 파티클을 작게 흘려 "살아서 도는 중"을 보이게 하고, 옆에
 * 지금 무엇을 하는지와 경과 시간을 함께 적는다 — 몇 십 초씩 걸리는 작업에서는
 * 진행 표시보다 "얼마나 됐는지"가 더 안심이 된다.
 */
export function ThinkingIndicator({
  label = "Thinking",
  elapsed,
  compact = false,
}: {
  label?: string;
  /** 초 단위 경과 시간. 주면 옆에 표시한다. */
  elapsed?: number;
  compact?: boolean;
}) {
  return (
    <div className={`thinking ${compact ? "compact" : ""}`} role="status" aria-live="polite">
      <span className="thinking-canvas">
        <ParticleFlow
          strands={compact ? 22 : 40}
          pointsPerStrand={compact ? 40 : 70}
          color="var(--create)"
          interactive={false}
        />
      </span>
      <span className="thinking-label">
        {label}
        <span className="thinking-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        {typeof elapsed === "number" && elapsed > 0 && (
          <span className="thinking-elapsed">{elapsed}s</span>
        )}
      </span>
    </div>
  );
}
