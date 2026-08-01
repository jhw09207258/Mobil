"use client";

import { useMemo, useState } from "react";
import "./storage-chart.css";
import { formatBytes } from "@/lib/format";

type Category = "files" | "documents" | "code" | "sheets" | "mindmaps" | "media";
type Row = { category: string; bytes: number; item_count: number };

// 순서 = 검증된 카테고리 팔레트 슬롯 순서(인접 쌍 CVD 안전성이 순서에 의존함,
// dataviz 스킬 참고). 임의로 재정렬하지 말 것.
const ORDER: Category[] = [
  "files",
  "documents",
  "code",
  "sheets",
  "mindmaps",
  "media",
];

// 짙은 파스텔 톤 팔레트 — 채도를 낮추고 명도를 맞춰 서로 잘 어울리게.
// 인접 쌍(블루-세이지-모브-허니-틸-테라코타)은 색상환에서 충분히 떨어져
// 있어 구분성이 유지된다.
const META: Record<Category, { label: string; color: string }> = {
  files: { label: "Repository", color: "#7c9cd0" },
  documents: { label: "Docs +", color: "#83b692" },
  code: { label: "Code", color: "#c08bbe" },
  sheets: { label: "Table", color: "#d9b36a" },
  mindmaps: { label: "Link Graph", color: "#7fb8ae" },
  media: { label: "Media", color: "#d89a84" },
};

const R = 40;
const CIRC = 2 * Math.PI * R;

export function StorageBreakdownChart({ rows }: { rows: Row[] }) {
  const [hover, setHover] = useState<Category | null>(null);

  const byCat = useMemo(() => {
    const m = new Map<string, Row>();
    for (const r of rows) m.set(r.category, r);
    return m;
  }, [rows]);

  const total = rows.reduce((s, r) => s + r.bytes, 0);
  const itemCount = rows.reduce((s, r) => s + r.item_count, 0);

  // 도넛 세그먼트 — 누적 dasharray offset 으로 원 둘레를 나눠 그린다.
  // 세그먼트 사이에 작은 틈(GAP)을 두고 끝을 둥글려(strokeLinecap="round")
  // bklit-ui 의 Ring 컴포넌트 느낌을 낸다 — 실제 비중(offset)은 틈 없는
  // 값으로 누적하고, 그리는 길이만 틈만큼 줄여 자리 배분은 정확하게 유지한다.
  const GAP = 3;
  let acc = 0;
  const segments = ORDER.map((cat) => {
    const bytes = byCat.get(cat)?.bytes ?? 0;
    const pct = total > 0 ? bytes / total : 0;
    const dash = pct * CIRC;
    const offset = acc;
    acc += dash;
    // 아주 작은 비중이라도 링에서 아예 사라지지 않도록 최소 길이를 보장한다
    // (틈 때문에 지워지면 범례엔 있는데 링엔 없는 항목이 생긴다).
    const visibleDash = dash > 0 ? Math.max(1.5, dash - GAP) : 0;
    const visibleOffset = offset + GAP / 2;
    return { cat, bytes, dash: visibleDash, offset: visibleOffset };
  }).filter((s) => s.dash > 0);

  const hoverRow = hover ? byCat.get(hover) : null;

  return (
    <div className="stg-donut-wrap">
      <div className="stg-donut">
        <svg viewBox="0 0 100 100">
          <circle className="stg-donut-track" cx="50" cy="50" r={R} />
          {segments.map((s) => (
            <circle
              key={s.cat}
              cx="50"
              cy="50"
              r={R}
              stroke={META[s.cat].color}
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={`${s.dash} ${CIRC - s.dash}`}
              strokeDashoffset={-s.offset}
              className={`stg-donut-seg ${hover && hover !== s.cat ? "dim" : ""}`}
              style={hover === s.cat ? { filter: `drop-shadow(0 0 5px ${META[s.cat].color})` } : undefined}
              onMouseEnter={() => setHover(s.cat)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
        <div className="stg-donut-center">
          {hoverRow ? (
            <>
              <div className="stg-donut-total">{formatBytes(hoverRow.bytes)}</div>
              <div className="stg-donut-sub">{hover && META[hover].label}</div>
            </>
          ) : (
            <>
              <div className="stg-donut-total">{formatBytes(total)}</div>
              <div className="stg-donut-sub">{itemCount} items</div>
            </>
          )}
        </div>
      </div>

      <div className="stg-legend">
        {ORDER.map((cat) => {
          const r = byCat.get(cat);
          if (!r || r.bytes === 0) return null;
          return (
            <div
              key={cat}
              className="stg-legend-item"
              onMouseEnter={() => setHover(cat)}
              onMouseLeave={() => setHover(null)}
            >
              <span className="stg-swatch" style={{ background: META[cat].color }} />
              <span className="stg-legend-label">{META[cat].label}</span>
              <span className="stg-legend-val">{formatBytes(r.bytes)}</span>
            </div>
          );
        })}
        {total === 0 && <span className="muted">No content yet.</span>}
      </div>
    </div>
  );
}

export function StorageShareBar({
  myBytes,
  platformBytes,
}: {
  myBytes: number;
  platformBytes: number;
}) {
  const pct = platformBytes > 0 ? (myBytes / platformBytes) * 100 : 0;
  const display = pct > 0 && pct < 0.1 ? "<0.1" : pct.toFixed(1);

  return (
    <div>
      <div className="stg-share-row">
        <span className="stg-share-pct">{display}%</span>
        <span className="stg-share-sub">of {formatBytes(platformBytes)} total</span>
      </div>
      <div className="stg-share-bar">
        <div
          className="stg-share-fill"
          style={{ width: `${Math.min(100, Math.max(pct > 0 ? 1.5 : 0, pct))}%` }}
        />
      </div>
      <p className="card-source">
        Source · Supabase Storage — project-wide bucket usage (files, documents,
        code, tables, link graphs and media), refreshed on each dashboard load.
      </p>
    </div>
  );
}
