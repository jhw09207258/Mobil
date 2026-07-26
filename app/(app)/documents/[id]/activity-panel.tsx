"use client";

import { IconClose } from "../../icons";

import { useCallback, useEffect, useRef, useState } from "react";
import { UserAvatar } from "@/components/user-avatar";
import { getDocumentActivity, type DocumentActivity } from "../actions";

function fmt(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" }) +
        " " +
        d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** 문서 우측 편집 활동 로그 — 접거나 펼칠 수 있다. saveState 가 "saved" 로
 * 바뀔 때(저장 완료)마다 새로고침해 최신 활동을 반영한다. */
export function ActivityPanel({
  docId,
  open,
  onClose,
  refreshToken,
}: {
  docId: string;
  open: boolean;
  onClose: () => void;
  refreshToken: unknown;
}) {
  const [rows, setRows] = useState<DocumentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const seenOpen = useRef(false);

  const load = useCallback(() => {
    getDocumentActivity(docId).then((data) => {
      setRows(data);
      setLoading(false);
    });
  }, [docId]);

  // 처음 열릴 때 + 저장될 때마다 갱신.
  useEffect(() => {
    if (!open) return;
    if (!seenOpen.current) seenOpen.current = true;
    load();
  }, [open, load, refreshToken]);

  if (!open) return null;

  return (
    <aside className="activity-panel">
      <div className="activity-head">
        <span className="label">EDIT ACTIVITY</span>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Collapse activity" title="Collapse">
          <IconClose size={12} />
        </button>
      </div>
      <div className="activity-body">
        {loading && <div className="empty" style={{ padding: 20 }}>Loading…</div>}
        {!loading && rows.length === 0 && (
          <div className="empty" style={{ padding: 20 }}>No edits recorded yet.</div>
        )}
        {rows.map((a) => (
          <div key={a.id} className="activity-item">
            <UserAvatar url={a.avatar_url} name={a.user_name} size={26} />
            <div className="activity-item-body">
              <div className="activity-item-top">
                <span className="activity-user">{a.user_name}</span>
                <span className="activity-time">{fmt(a.created_at)}</span>
              </div>
              <div className="activity-delta">
                {a.added > 0 && <span className="activity-add">+{a.added}</span>}
                {a.removed > 0 && <span className="activity-del">−{a.removed}</span>}
                <span className="dim" style={{ fontSize: 11 }}>chars</span>
              </div>
              {a.preview && <div className="activity-preview">“{a.preview}”</div>}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
