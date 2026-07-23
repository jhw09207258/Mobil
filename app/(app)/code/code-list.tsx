"use client";

import { useMemo, useState } from "react";
import { formatDate } from "@/lib/format";
import { OpenItemButton } from "../workspace/open-item-button";
import { StarButton } from "../star-button";
import { ShareDialog } from "@/components/share-dialog";
import { shareCodeFile, revokeCodeFileShare, listCodeFileShares } from "./actions";

type CodeRow = {
  id: string;
  owner_id: string;
  name: string;
  language: string;
  is_public: boolean;
  updated_at: string;
};

export function CodeList({
  files,
  userId,
  starredIds,
}: {
  files: CodeRow[];
  userId: string;
  starredIds: string[];
}) {
  const [query, setQuery] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [starredSet, setStarredSet] = useState(() => new Set(starredIds));
  const [shareTarget, setShareTarget] = useState<CodeRow | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files
      .filter((c) => !starredOnly || starredSet.has(c.id))
      .filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          c.language.toLowerCase().includes(q)
      );
  }, [files, query, starredOnly, starredSet]);

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
          CODE FILES ({filtered.length}
          {query || starredOnly ? ` / ${files.length}` : ""})
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
            placeholder="Search filename or language…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      {files.length === 0 ? (
        <div className="empty">No code files yet. Use “New code file” to start.</div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          {starredOnly ? "No starred code files." : `No files match “${query}”.`}
        </div>
      ) : (
        <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 34 }}></th>
              <th>Filename</th>
              <th style={{ width: 130 }}>Language</th>
              <th style={{ width: 90 }}>Visibility</th>
              <th style={{ width: 60 }}>Owner</th>
              <th style={{ width: 180 }}>Updated</th>
              <th style={{ width: 150 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <td>
                  <StarButton
                    kind="code"
                    id={c.id}
                    initialStarred={starredSet.has(c.id)}
                    onChange={(v) => setStarred(c.id, v)}
                  />
                </td>
                <td className="mono">
                  <OpenItemButton kind="code" id={c.id} title={c.name} className="link-btn">
                    {c.name}
                  </OpenItemButton>
                </td>
                <td className="mono muted" style={{ fontSize: 12 }}>
                  {c.language}
                </td>
                <td>
                  {c.is_public ? (
                    <span className="badge badge-ok">public</span>
                  ) : (
                    <span className="badge">private</span>
                  )}
                </td>
                <td>
                  <span className="badge">
                    {c.owner_id === userId ? "Mine" : "Shared"}
                  </span>
                </td>
                <td className="mono muted" style={{ fontSize: 12 }}>
                  {formatDate(c.updated_at)}
                </td>
                <td>
                  <div className="row row-actions" style={{ gap: 4, justifyContent: "flex-end" }}>
                    {c.owner_id === userId && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setShareTarget(c)}
                      >
                        Share
                      </button>
                    )}
                    <OpenItemButton kind="code" id={c.id} title={c.name} className="btn btn-ghost btn-sm">
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
        targetLabel={shareTarget.name}
        myShareId={userId}
        loadShares={() => listCodeFileShares(shareTarget.id)}
        onShare={(rid, perm) => shareCodeFile(shareTarget.id, rid, perm)}
        onRevoke={(pid) => revokeCodeFileShare(pid)}
        onClose={() => setShareTarget(null)}
      />
    )}
    </>
  );
}
