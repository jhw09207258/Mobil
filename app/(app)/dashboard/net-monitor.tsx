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
  const h = 34;
  const points = hist
    .map((v, i) => `${((i / (WINDOW - 1)) * w).toFixed(1)},${(h - (v / max) * (h - 4)).toFixed(1)}`)
    .join(" ");
  const areaPoints = hist.length > 1 ? `0,${h} ${points} ${((hist.length - 1) / (WINDOW - 1)) * w},${h}` : "";

  return (
    <div className="netmon">
      <div className="netmon-top">
        <span className="netmon-rate">{fmtRate(rate)}</span>
        <span className="netmon-meta label">PEAK {fmtRate(peak)}</span>
      </div>
      {/* 카드 폭 전체를 채우는 스파크라인(면 채움 포함) */}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="netmon-spark"
        aria-hidden="true"
      >
        {hist.length > 1 && (
          <>
            <polygon points={areaPoints} fill="var(--create-ghost)" />
            <polyline
              points={points}
              fill="none"
              stroke="var(--create)"
              strokeWidth="1.5"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>
      <div className="netmon-meta label">LAST 30 SECONDS</div>
      <p className="card-source">
        Source · live network traffic between this app and the Vercel/Supabase
        servers, measured in your browser every second.
      </p>
    </div>
  );
}
