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

export function StorageBreakdownChart({ rows }: { rows: Row[] }) {
  const [hover, setHover] = useState<Category | null>(null);

  const byCat = useMemo(() => {
    const m = new Map<string, Row>();
    for (const r of rows) m.set(r.category, r);
    return m;
  }, [rows]);

  const total = rows.reduce((s, r) => s + r.bytes, 0);

  // 세그먼트 중심의 대략적 위치(%) — 툴팁 가로 배치용
  let cursor = 0;
  const positions = new Map<Category, number>();
  for (const cat of ORDER) {
    const bytes = byCat.get(cat)?.bytes ?? 0;
    const pct = total > 0 ? (bytes / total) * 100 : 0;
    positions.set(cat, cursor + pct / 2);
    cursor += pct;
  }

  return (
    <div>
      <div className="stg-total">
        {formatBytes(total)}
        <span className="unit">used across {rows.reduce((s, r) => s + r.item_count, 0)} items</span>
      </div>

      <div className="stg-bar-wrap">
        {hover && total > 0 && (
          <div
            className="stg-tooltip"
            style={{ left: `${positions.get(hover)}%` }}
          >
            {META[hover].label}
            <span className="k">
              {formatBytes(byCat.get(hover)?.bytes ?? 0)} ·{" "}
              {byCat.get(hover)?.item_count ?? 0} items
            </span>
          </div>
        )}
        <div className={`stg-bar ${total === 0 ? "empty" : ""}`}>
          {total === 0
            ? null
            : ORDER.map((cat) => {
                const bytes = byCat.get(cat)?.bytes ?? 0;
                if (bytes === 0) return null;
                const pct = (bytes / total) * 100;
                return (
                  <div
                    key={cat}
                    className={`stg-seg ${hover && hover !== cat ? "dim" : ""}`}
                    style={{ width: `${pct}%`, background: META[cat].color }}
                    onMouseEnter={() => setHover(cat)}
                    onMouseLeave={() => setHover(null)}
                  />
                );
              })}
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
      <p className="page-sub" style={{ margin: "10px 0 0" }}>
        You are using <strong style={{ color: "var(--text-0)" }}>{formatBytes(myBytes)}</strong> of
        the shared Mobil storage pool.
      </p>
      <p className="card-source">
        Source · Supabase Storage — project-wide bucket usage (files, documents,
        code, tables, link graphs and media), refreshed on each dashboard load.
      </p>
    </div>
  );
}
