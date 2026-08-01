"use client";

import { useState } from "react";

type Row = { day: string; item_count: number };

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 위쪽 두 모서리만 둥근 막대 경로 — <rect rx> 는 네 모서리를 다 둥글리므로
 * 바닥에 틈이 생긴다(막대가 기준선에 딱 붙어야 한다). bklit-ui 의 Bar
 * 컴포넌트가 쓰는 것과 같은 모양을 라이브러리 없이 직접 그린다. */
function topRoundedBarPath(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.max(0, Math.min(r, w / 2, h));
  if (radius <= 0.5) return `M${x},${y} h${w} v${h} h${-w} Z`;
  return `M${x},${y + radius}
    a${radius},${radius} 0 0 1 ${radius},${-radius}
    h${w - 2 * radius}
    a${radius},${radius} 0 0 1 ${radius},${radius}
    v${h - radius}
    h${-w}
    Z`;
}

/**
 * 이번 주 활동 막대그래프 — 최근 7일간 내가 만든 항목 수(my_weekly_activity,
 * 0079). bklit-ui(github.com/bklit/bklit-ui) 의 Bar 컴포넌트에서 위쪽만
 * 둥근 막대 + 진입 애니메이션 + 호버 시 나머지를 옅게 만드는 시각 언어를
 * 가져왔다 — visx/motion 의존성 없이 순수 SVG + CSS 애니메이션으로 다시
 * 구현했다(이 프로젝트는 지금까지 그래프를 전부 이런 식으로 직접 그려 왔다,
 * repository-graph.tsx 도 같은 원칙).
 */
export function WeeklyActivityChart({ rows }: { rows: Row[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.item_count));
  const total = rows.reduce((s, r) => s + r.item_count, 0);

  const W = 420;
  const H = 150;
  const padTop = 8;
  const padBottom = 22;
  const chartH = H - padTop - padBottom;
  const gap = 10;
  const barW = (W - gap * (rows.length - 1)) / rows.length;

  return (
    <div className="wk-chart">
      <div className="wk-chart-head">
        <span className="wk-chart-total">{total}</span>
        <span className="dim" style={{ fontSize: 12 }}>
          item{total === 1 ? "" : "s"} created this week
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="wk-chart-svg" preserveAspectRatio="none">
        {rows.map((r, i) => {
          const x = i * (barW + gap);
          const h = r.item_count > 0 ? Math.max(4, (r.item_count / max) * chartH) : 0;
          const y = padTop + (chartH - h);
          const d = new Date(`${r.day}T00:00:00`);
          const isToday = i === rows.length - 1;
          const faded = hover !== null && hover !== i;
          return (
            <g
              key={r.day}
              className="wk-bar-group"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <rect
                x={x}
                y={padTop}
                width={barW}
                height={chartH}
                fill="transparent"
                className="wk-bar-hitzone"
              />
              {h > 0 && (
                <path
                  d={topRoundedBarPath(x, y, barW, h, 6)}
                  className="wk-bar"
                  style={{ animationDelay: `${i * 45}ms`, opacity: faded ? 0.35 : 1 }}
                />
              )}
              <text x={x + barW / 2} y={H - 6} textAnchor="middle" className={`wk-bar-label ${isToday ? "today" : ""}`}>
                {WEEKDAY[d.getDay()]}
              </text>
              {hover === i && (
                <text x={x + barW / 2} y={y - 6} textAnchor="middle" className="wk-bar-value">
                  {r.item_count}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
