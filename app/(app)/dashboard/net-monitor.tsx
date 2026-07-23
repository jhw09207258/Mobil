"use client";

import { useEffect, useRef, useState } from "react";

const WINDOW = 30; // 스파크라인 표본 수(초)

function fmtRate(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${Math.round(bytesPerSec)} B/s`;
}

/**
 * 실시간 데이터 전송 속도 — PerformanceObserver 로 이 탭이 주고받는 네트워크
 * 리소스(fetch/XHR, Supabase 호출 포함)의 transferSize 를 1초 단위로 합산해
 * 현재 속도 + 최근 30초 스파크라인으로 보여준다.
 */
export function NetMonitor() {
  const [rate, setRate] = useState(0);
  const [peak, setPeak] = useState(0);
  const [hist, setHist] = useState<number[]>([]);
  const bytesRef = useRef(0);

  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        bytesRef.current += (e as PerformanceResourceTiming).transferSize || 0;
      }
    });
    try {
      obs.observe({ type: "resource", buffered: false });
    } catch {
      return; // 지원 안 하는 브라우저 — 위젯은 0 으로 남는다.
    }
    const t = setInterval(() => {
      const b = bytesRef.current;
      bytesRef.current = 0;
      setRate(b);
      setPeak((p) => Math.max(p, b));
      setHist((h) => [...h.slice(-(WINDOW - 1)), b]);
    }, 1000);
    return () => {
      obs.disconnect();
      clearInterval(t);
    };
  }, []);

  const max = Math.max(peak, 1);
  const w = 120;
  const h = 28;
  const points = hist
    .map((v, i) => `${((i / (WINDOW - 1)) * w).toFixed(1)},${(h - (v / max) * (h - 2)).toFixed(1)}`)
    .join(" ");

  return (
    <div className="netmon">
      <div className="netmon-rate mono">{fmtRate(rate)}</div>
      <svg width={w} height={h} className="netmon-spark" aria-hidden="true">
        {hist.length > 1 && (
          <polyline
            points={points}
            fill="none"
            stroke="var(--create)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        )}
      </svg>
      <div className="netmon-meta label">PEAK {fmtRate(peak)} · LAST 30S</div>
    </div>
  );
}
