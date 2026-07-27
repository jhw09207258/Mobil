"use client";

import { useMemo, useState } from "react";
import { formatDate } from "@/lib/format";
import { OpenItemButton } from "../workspace/open-item-button";
import { StarButton } from "../star-button";
import { SendToChatButton } from "../send-to-chat-button";
import { ShareDialog } from "@/components/share-dialog";
import { shareSheet, revokeSheetShare, listSheetShares } from "./actions";

type SheetRow = {
  id: string;
  owner_id: string;
  title: string;
  is_public: boolean;
  updated_at: string;
};

export function SheetList({
  sheets,
  userId,
  starredIds,
}: {
  sheets: SheetRow[];
  userId: string;
  starredIds: string[];
}) {
  const [query, setQuery] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [starredSet, setStarredSet] = useState(() => new Set(starredIds));
  const [shareTarget, setShareTarget] = useState<SheetRow | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sheets
      .filter((s) => !starredOnly || starredSet.has(s.id))
      .filter((s) => !q || (s.title || "").toLowerCase().includes(q));
  }, [sheets, query, starredOnly, starredSet]);

  const setStarred = (id: string, starred: boolean) => {
    setStarredSet((prev) => {
      const next = new Set(prev);
      if (starred) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <>
    <div className="panel">
      <div className="panel-header">
        <span className="label">
          TABLE ({filtered.length}
          {query || starredOnly ? ` / ${sheets.length}` : ""})
        </span>
        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            className={`btn btn-ghost btn-sm filter-star ${starredOnly ? "active" : ""}`}
            onClick={() => setStarredOnly((v) => !v)}
            aria-pressed={starredOnly}
          >
            {starredOnly ? "★" : "☆"} Starred
          </button>
          <input
            className="input"
            style={{ width: 240, height: 30 }}
            placeholder="Search title…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      {sheets.length === 0 ? (
        <div className="empty">No tables yet. Use “New sheet” to start.</div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          {starredOnly ? "No starred tables." : `No tables match “${query}”.`}
        </div>
      ) : (
        <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 34 }}></th>
              <th>Title</th>
              <th style={{ width: 90 }}>Visibility</th>
              <th style={{ width: 60 }}>Owner</th>
              <th style={{ width: 180 }}>Updated</th>
              <th style={{ width: 150 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id}>
                <td>
                  <StarButton
                    kind="sheet"
                    id={s.id}
                    initialStarred={starredSet.has(s.id)}
                    onChange={(v) => setStarred(s.id, v)}
                  />
                </td>
                <td>
                  <OpenItemButton kind="sheet" id={s.id} title={s.title || "Untitled sheet"} className="link-btn">
                    {s.title || "Untitled sheet"}
                  </OpenItemButton>
                </td>
                <td>
                  {s.is_public ? (
                    <span className="badge badge-ok">public</span>
                  ) : (
                    <span className="badge">private</span>
                  )}
                </td>
                <td>
                  <span className="badge">{s.owner_id === userId ? "Mine" : "Shared"}</span>
                </td>
                <td className="mono muted" style={{ fontSize: 12 }}>
                  {formatDate(s.updated_at)}
                </td>
                <td>
                  <div className="row row-actions" style={{ gap: 4, justifyContent: "flex-end" }}>
                    {s.owner_id === userId && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setShareTarget(s)}
                      >
                        Share
                      </button>
                    )}
                    <SendToChatButton
                      kind="sheet"
                      id={s.id}
                      title={s.title || "Untitled sheet"}
                      canGrant={s.owner_id === userId}
                      label="Chat"
                    />
                    <OpenItemButton kind="sheet" id={s.id} title={s.title || "Untitled sheet"} className="btn btn-ghost btn-sm">
                      Open
                    </OpenItemButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>

    {shareTarget && (
      <ShareDialog
        targetLabel={shareTarget.title || "Untitled sheet"}
        myShareId={userId}
        loadShares={() => listSheetShares(shareTarget.id)}
        onShare={(rid, perm) => shareSheet(shareTarget.id, rid, perm)}
        onRevoke={(pid) => revokeSheetShare(pid)}
        onClose={() => setShareTarget(null)}
      />
    )}
    </>
  );
}
