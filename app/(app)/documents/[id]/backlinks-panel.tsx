"use client";

import { useCallback, useEffect, useState } from "react";
import { IconClose, IconDocuments, IconCode, IconSheet, IconMindmap, IconFiles } from "../../icons";
import { getBacklinks, type Backlink } from "../../search/actions";
import { useWorkspace, type TabKind } from "../../workspace/workspace-context";

const KIND_ICON: Record<string, (props: { size?: number }) => React.ReactElement> = {
  document: IconDocuments,
  code: IconCode,
  sheet: IconSheet,
  mindmap: IconMindmap,
  file: IconFiles,
};
const OPENABLE = new Set(["document", "code", "sheet", "mindmap"]);

/**
 * 백링크 패널 — "이 문서를 가리키는 다른 것들"만 보여준다(Obsidian 의
 * Backlinks 패널). 내가 이 문서에서 건 링크는 본문에 칩으로 이미 보이므로
 * 여기엔 안 나온다 — 본문을 읽어서는 알 수 없는 반대 방향만 다룬다.
 * ActivityPanel 과 같은 자리·같은 여닫이 패턴을 그대로 따른다.
 */
export function BacklinksPanel({
  kind,
  id,
  open,
  onClose,
  refreshToken,
}: {
  kind: string;
  id: string;
  open: boolean;
  onClose: () => void;
  refreshToken: unknown;
}) {
  const [rows, setRows] = useState<Backlink[]>([]);
  const [loading, setLoading] = useState(true);
  const { openTab } = useWorkspace();

  const load = useCallback(() => {
    getBacklinks(kind, id).then((data) => {
      setRows(data);
      setLoading(false);
    });
  }, [kind, id]);

  // 처음 열릴 때 + 저장될 때마다(내 문서를 새로 참조한 문서가 방금 저장됐을
  // 수도 있으니) 갱신.
  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load, refreshToken]);

  if (!open) return null;

  return (
    <aside className="activity-panel">
      <div className="activity-head">
        <span className="label">BACKLINKS</span>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Collapse backlinks" title="Collapse">
          <IconClose size={12} />
        </button>
      </div>
      <div className="activity-body">
        {loading && <div className="empty" style={{ padding: 20 }}>Loading…</div>}
        {!loading && rows.length === 0 && (
          <div className="empty" style={{ padding: 20 }}>
            Nothing links here yet.
          </div>
        )}
        {!loading && rows.length > 0 && (
          <div style={{ padding: "2px 4px" }}>
            {rows.map((r) => {
              const Icon = KIND_ICON[r.kind] ?? IconDocuments;
              const openable = OPENABLE.has(r.kind);
              return (
                <button
                  key={`${r.kind}:${r.id}`}
                  type="button"
                  className="search-linked-item"
                  style={{ width: "100%" }}
                  disabled={!openable}
                  onClick={() => openable && openTab(r.kind as TabKind, r.id, r.title)}
                >
                  <Icon size={12} />
                  <span>{r.title}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
