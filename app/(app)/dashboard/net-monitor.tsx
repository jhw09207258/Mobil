"use client";

import { useEffect, useRef, useState } from "react";
import { ParticleFlow } from "@/components/particle-flow";

function fmtRate(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${Math.round(bytesPerSec)} B/s`;
}

/**
 * 실시간 데이터 전송 속도 — PerformanceObserver 로 이 탭이 주고받는 네트워크
 * 리소스(fetch/XHR, Supabase 호출 포함)의 transferSize 를 1초 단위로 합산해
 * 현재 속도 + 피크를 보여준다. 시각화는 벡터 파티클 플로우로, 전송량이
 * 많을수록 흐름이 빨라지는 형태로 밀도/속도를 표현한다.
 */
export function NetMonitor() {
  const [rate, setRate] = useState(0);
  const [peak, setPeak] = useState(0);
  const bytesRef = useRef(0);
  const peakRef = useRef(1);
  const intensityRef = useRef(0.35);

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

    const tick = setInterval(() => {
      const b = bytesRef.current;
      bytesRef.current = 0;
      peakRef.current = Math.max(peakRef.current, b, 1);
      intensityRef.current = Math.min(1.6, 0.3 + (b / peakRef.current) * 1.3);
      setRate(b);
      setPeak((p) => Math.max(p, b));
    }, 1000);

    return () => {
      obs.disconnect();
      clearInterval(tick);
    };
  }, []);

  return (
    <div className="netmon">
      <div className="netmon-top">
        <span className="netmon-rate">{fmtRate(rate)}</span>
        <span className="netmon-meta label">PEAK {fmtRate(peak)}</span>
      </div>
      <div className="netmon-particles">
        <ParticleFlow
          color="#4a86dd"
          strands={70}
          pointsPerStrand={140}
          interactive={false}
          intensityRef={intensityRef}
        />
      </div>
      <div className="netmon-meta label">VECTOR THROUGHPUT</div>
      <p className="card-source">
        Source · live network traffic between this app and the Vercel/Supabase
        servers, measured in your browser every second — visualized as particle flow density.
      </p>
    </div>
  );
}
