"use client";

import { useMemo, useState } from "react";
import { formatDate } from "@/lib/format";
import { OpenItemButton } from "../workspace/open-item-button";
import { StarButton } from "../star-button";
import { SendToChatButton } from "../send-to-chat-button";
import { ShareDialog } from "@/components/share-dialog";
import { shareDocument, revokeDocumentShare, listDocumentShares } from "./actions";

type DocRow = {
  id: string;
  owner_id: string;
  title: string;
  is_public: boolean;
  updated_at: string;
};

export function DocumentsList({
  docs,
  userId,
  starredIds,
}: {
  docs: DocRow[];
  userId: string;
  starredIds: string[];
}) {
  const [query, setQuery] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [starredSet, setStarredSet] = useState(() => new Set(starredIds));
  const [shareTarget, setShareTarget] = useState<DocRow | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs
      .filter((d) => !starredOnly || starredSet.has(d.id))
      .filter((d) => !q || (d.title || "").toLowerCase().includes(q));
  }, [docs, query, starredOnly, starredSet]);

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
          DOCS + ({filtered.length}
          {query || starredOnly ? ` / ${docs.length}` : ""})
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
      {docs.length === 0 ? (
        <div className="empty">No docs yet. Use “New document” to start.</div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          {starredOnly ? "No starred docs." : `No docs match “${query}”.`}
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
            {filtered.map((d) => (
              <tr key={d.id}>
                <td>
                  <StarButton
                    kind="document"
                    id={d.id}
                    initialStarred={starredSet.has(d.id)}
                    onChange={(v) => setStarred(d.id, v)}
                  />
                </td>
                <td>
                  <OpenItemButton kind="document" id={d.id} title={d.title || "Untitled"} className="link-btn">
                    {d.title || "Untitled"}
                  </OpenItemButton>
                </td>
                <td>
                  {d.is_public ? (
                    <span className="badge badge-ok">public</span>
                  ) : (
                    <span className="badge">private</span>
                  )}
                </td>
                <td>
                  <span className="badge">
                    {d.owner_id === userId ? "Mine" : "Shared"}
                  </span>
                </td>
                <td className="mono muted" style={{ fontSize: 12 }}>
                  {formatDate(d.updated_at)}
                </td>
                <td>
                  <div className="row row-actions" style={{ gap: 4, justifyContent: "flex-end" }}>
                    {d.owner_id === userId && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setShareTarget(d)}
                      >
                        Share
                      </button>
                    )}
                    <SendToChatButton
                      kind="document"
                      id={d.id}
                      title={d.title || "Untitled"}
                      canGrant={d.owner_id === userId}
                      label="Chat"
                    />
                    <OpenItemButton kind="document" id={d.id} title={d.title || "Untitled"} className="btn btn-ghost btn-sm">
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
        targetLabel={shareTarget.title || "Untitled"}
        myShareId={userId}
        loadShares={() => listDocumentShares(shareTarget.id)}
        onShare={(rid, perm) => shareDocument(shareTarget.id, rid, perm)}
        onRevoke={(pid) => revokeDocumentShare(pid)}
        onClose={() => setShareTarget(null)}
      />
    )}
    </>
  );
}
