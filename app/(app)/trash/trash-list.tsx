"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconDocuments, IconCode, IconSheet, IconMindmap, IconFiles } from "../icons";
import { purgeItem, restoreItem, type TrashItem } from "./actions";

const KIND_ICON: Record<string, (p: { size?: number }) => React.ReactElement> = {
  document: IconDocuments,
  code: IconCode,
  sheet: IconSheet,
  mindmap: IconMindmap,
  file: IconFiles,
};
const KIND_LABEL: Record<string, string> = {
  document: "Docs +",
  code: "Code",
  sheet: "Table",
  mindmap: "Link Graph",
  file: "File",
};

/** 남은 시간을 "5h 12m" 형태로. 이미 지났으면 곧 정리된다는 뜻. */
function timeLeft(expiresAt: string, now: number): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return "Removing soon";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

export function TrashList({ items }: { items: TrashItem[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  // 남은 시간이 흘러가는 게 보이도록 1분마다 다시 계산한다.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const run = async (key: string, fn: () => Promise<{ ok: true } | { error: string }>) => {
    setBusy(key);
    setError(null);
    const res = await fn();
    setBusy(null);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    start(() => router.refresh());
  };

  if (items.length === 0) {
    return <div className="empty">Trash is empty.</div>;
  }

  return (
    <>
      {error && <div className="notice notice-error">{error}</div>}
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 44 }}></th>
              <th>Name</th>
              <th style={{ width: 110 }} className="col-hide-mobile">Type</th>
              <th style={{ width: 130 }}>Auto-delete</th>
              <th style={{ width: 190 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const Icon = KIND_ICON[it.kind] ?? IconDocuments;
              const key = `${it.kind}:${it.id}`;
              return (
                <tr key={key}>
                  <td>
                    <span className="drive-icon">
                      <Icon size={16} />
                    </span>
                  </td>
                  <td>{it.title}</td>
                  <td className="muted col-hide-mobile">{KIND_LABEL[it.kind] ?? it.kind}</td>
                  <td className="mono muted" style={{ fontSize: 12 }}>
                    {timeLeft(it.expires_at, now)}
                  </td>
                  <td>
                    <div className="row row-actions" style={{ gap: 4 }}>
                      <button
                        className="btn btn-sm"
                        disabled={busy === key}
                        onClick={() => run(key, () => restoreItem(it.kind, it.id))}
                      >
                        Restore
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        disabled={busy === key}
                        onClick={() => {
                          if (!confirm(`Permanently delete "${it.title}"? This cannot be undone.`)) return;
                          run(key, () => purgeItem(it.kind, it.id, it.storage_path));
                        }}
                      >
                        Delete now
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
