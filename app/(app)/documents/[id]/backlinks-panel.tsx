"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IconClose, IconDocuments, IconCode, IconSheet, IconMindmap, IconFiles, IconCalendar } from "../../icons";
import { getBacklinks, getObjectEvents, type Backlink, type LinkedEvent } from "../../search/actions";
import { useWorkspace, type TabKind } from "../../workspace/workspace-context";

const KIND_ICON: Record<string, (props: { size?: number }) => React.ReactElement> = {
  document: IconDocuments,
  code: IconCode,
  sheet: IconSheet,
  mindmap: IconMindmap,
  file: IconFiles,
};
const OPENABLE = new Set(["document", "code", "sheet", "mindmap"]);

function formatEventWhen(iso: string, allDay: boolean): string {
  const d = new Date(iso);
  return allDay
    ? d.toLocaleDateString([], { month: "short", day: "numeric" })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * 백링크 패널 — "이 문서를 가리키는 다른 것들"만 보여준다(Obsidian 의
 * Backlinks 패널). 내가 이 문서에서 건 링크는 본문에 칩으로 이미 보이므로
 * 여기엔 안 나온다 — 본문을 읽어서는 알 수 없는 반대 방향만 다룬다.
 * ActivityPanel 과 같은 자리·같은 여닫이 패턴을 그대로 따른다.
 *
 * 캘린더 일정도 여기 같이 보여준다 — 이 문서를 참조하는 일정(link_event_object)
 * 도 "무언가 나를 가리킨다"는 점에서 백링크와 같은 개념이다. 별도 패널을
 * 새로 만드는 대신 이 자리에 묶어, 새 UI 표면을 하나 더 늘리지 않는다.
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
  const router = useRouter();
  const [rows, setRows] = useState<Backlink[]>([]);
  const [events, setEvents] = useState<LinkedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const { openTab } = useWorkspace();

  const load = useCallback(() => {
    Promise.all([getBacklinks(kind, id), getObjectEvents(kind, id)]).then(([links, evs]) => {
      setRows(links);
      setEvents(evs);
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
        <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="Collapse backlinks" title="Collapse">
          <IconClose size={12} />
        </button>
      </div>
      <div className="activity-body">
        {loading && <div className="empty" style={{ padding: 20 }}>Loading…</div>}
        {!loading && rows.length === 0 && events.length === 0 && (
          <div className="empty" style={{ padding: 20 }}>
            Nothing links here yet.
          </div>
        )}
        {!loading && events.length > 0 && (
          <div style={{ padding: "2px 4px" }}>
            <div className="label" style={{ padding: "6px 8px 2px", fontSize: 10 }}>EVENTS</div>
            {events.map((e) => (
              <button
                key={e.id}
                type="button"
                className="search-linked-item"
                style={{ width: "100%" }}
                onClick={() => router.push(`/calendar?event=${e.id}`)}
              >
                <IconCalendar size={12} />
                <span>{e.title}</span>
                <span className="dim" style={{ fontSize: 11 }}> · {formatEventWhen(e.starts_at, e.all_day)}</span>
              </button>
            ))}
          </div>
        )}
        {!loading && rows.length > 0 && (
          <div style={{ padding: "2px 4px" }}>
            {events.length > 0 && <div className="label" style={{ padding: "6px 8px 2px", fontSize: 10 }}>LINKS</div>}
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
