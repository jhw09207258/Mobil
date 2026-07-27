"use client";

import { useMemo, useState } from "react";
import { formatDate } from "@/lib/format";
import { OpenItemButton } from "../workspace/open-item-button";
import { SendToChatButton } from "../send-to-chat-button";
import { ShareDialog } from "@/components/share-dialog";
import { shareMindMap, revokeMindMapShare, listMindMapShares } from "./actions";

type MapRow = {
  id: string;
  owner_id: string;
  title: string;
  is_public: boolean;
  updated_at: string;
};

export function MindMapList({ maps, userId }: { maps: MapRow[]; userId: string }) {
  const [query, setQuery] = useState("");
  const [shareTarget, setShareTarget] = useState<MapRow | null>(null);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return maps;
    return maps.filter((m) => (m.title || "").toLowerCase().includes(q));
  }, [maps, query]);

  return (
    <>
    <div className="panel">
      <div className="panel-header">
        <span className="label">
          LINK GRAPH ({filtered.length}
          {query ? ` / ${maps.length}` : ""})
        </span>
        <input
          className="input"
          style={{ width: 240, height: 30 }}
          placeholder="Search title…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {maps.length === 0 ? (
        <div className="empty">No link graphs yet. Use “New map” to start.</div>
      ) : filtered.length === 0 ? (
        <div className="empty">No link graphs match “{query}”.</div>
      ) : (
        <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th style={{ width: 90 }}>Visibility</th>
              <th style={{ width: 60 }}>Owner</th>
              <th style={{ width: 180 }}>Updated</th>
              <th style={{ width: 150 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr key={m.id}>
                <td>
                  <OpenItemButton kind="mindmap" id={m.id} title={m.title || "Untitled map"} className="link-btn">
                    {m.title || "Untitled map"}
                  </OpenItemButton>
                </td>
                <td>
                  {m.is_public ? (
                    <span className="badge badge-ok">public</span>
                  ) : (
                    <span className="badge">private</span>
                  )}
                </td>
                <td>
                  <span className="badge">{m.owner_id === userId ? "Mine" : "Shared"}</span>
                </td>
                <td className="mono muted" style={{ fontSize: 12 }}>
                  {formatDate(m.updated_at)}
                </td>
                <td>
                  <div className="row row-actions" style={{ gap: 4, justifyContent: "flex-end" }}>
                    {m.owner_id === userId && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setShareTarget(m)}
                      >
                        Share
                      </button>
                    )}
                    <SendToChatButton
                      kind="mindmap"
                      id={m.id}
                      title={m.title || "Untitled map"}
                      canGrant={m.owner_id === userId}
                      label="Chat"
                    />
                    <OpenItemButton kind="mindmap" id={m.id} title={m.title || "Untitled map"} className="btn btn-ghost btn-sm">
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
        targetLabel={shareTarget.title || "Untitled map"}
        myShareId={userId}
        loadShares={() => listMindMapShares(shareTarget.id)}
        onShare={(rid, perm) => shareMindMap(shareTarget.id, rid, perm)}
        onRevoke={(pid) => revokeMindMapShare(pid)}
        onClose={() => setShareTarget(null)}
      />
    )}
    </>
  );
}
