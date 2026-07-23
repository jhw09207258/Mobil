"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatBytes, formatDate } from "@/lib/format";
import { getFileCategory, FILE_CATEGORY_LABEL, type FileCategory } from "@/lib/file-category";
import { extractTagsFromText } from "@/lib/tags";
import { ShareDialog } from "@/components/share-dialog";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { StarButton } from "../star-button";
import {
  deleteFile,
  getSignedUrl,
  renameFile,
  shareFile,
  revokeFileShare,
  listFileShares,
} from "./actions";
import {
  setItemRepository,
  listRepositoryContents,
  createRepository,
  type Repository,
  type RepositoryContents,
} from "../repositories/actions";
import { OpenItemButton } from "../workspace/open-item-button";

type FileRow = {
  id: string;
  owner_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  is_public: boolean;
  created_at: string;
  repository_id: string | null;
  canEdit: boolean;
};

const BUCKET = "files";

export function FilesClient({
  initialFiles,
  userId,
  starredIds,
  repositories,
}: {
  initialFiles: FileRow[];
  userId: string;
  starredIds: string[];
  repositories: Repository[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<FileRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileRow | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FileCategory | "all">("all");
  const [starredOnly, setStarredOnly] = useState(false);
  const [starredSet, setStarredSet] = useState(() => new Set(starredIds));
  const [dragOver, setDragOver] = useState(false);
  // 저장소 필터: "all" | "null"(Null Repository) | repo id
  const [repoFilter, setRepoFilter] = useState<string>("all");
  const [repoRows, setRepoRows] = useState(() => new Map(initialFiles.map((f) => [f.id, f.repository_id])));
  const [repoContents, setRepoContents] = useState<RepositoryContents | null>(null);
  const dragDepth = useRef(0);
  const [pending, start] = useTransition();

  const setStarred = (id: string, starred: boolean) => {
    setStarredSet((prev) => {
      const next = new Set(prev);
      if (starred) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const onPick = () => inputRef.current?.click();

  const categorized = useMemo(
    () =>
      initialFiles.map((f) => ({
        file: f,
        category: getFileCategory(f.file_name, f.mime_type),
      })),
    [initialFiles]
  );

  const categoryCounts = useMemo(() => {
    const counts = new Map<FileCategory, number>();
    for (const { category: c } of categorized) counts.set(c, (counts.get(c) ?? 0) + 1);
    return counts;
  }, [categorized]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return categorized
      .filter(({ file: f }) => {
        if (repoFilter === "all") return true;
        const rid = repoRows.get(f.id) ?? null;
        return repoFilter === "null" ? rid === null : rid === repoFilter;
      })
      .filter(({ category: c }) => category === "all" || c === category)
      .filter(({ file: f }) => !starredOnly || starredSet.has(f.id))
      .filter(
        ({ file: f }) =>
          !q ||
          f.file_name.toLowerCase().includes(q) ||
          (f.mime_type ?? "").toLowerCase().includes(q)
      )
      .map(({ file }) => file);
  }, [categorized, query, category, starredOnly, starredSet, repoFilter, repoRows]);

  // 특정 저장소를 선택하면 그 저장소의 문서/코드/시트/마인드맵도 함께 보여준다.
  const selectRepo = (value: string) => {
    setRepoFilter(value);
    if (value === "all") {
      setRepoContents(null);
      return;
    }
    listRepositoryContents(value === "null" ? null : value).then(setRepoContents);
  };

  const onNewRepo = async () => {
    const name = prompt("New repository name");
    if (!name?.trim()) return;
    const res = await createRepository(name);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    router.refresh();
  };

  const moveFileRepo = async (fileId: string, value: string) => {
    const next = value === "" ? null : value;
    const prev = repoRows.get(fileId) ?? null;
    setRepoRows((m) => new Map(m).set(fileId, next));
    const res = await setItemRepository("file", fileId, next);
    if ("error" in res) {
      setRepoRows((m) => new Map(m).set(fileId, prev));
      setError(res.error);
    }
  };

  const uploadFiles = async (fileList: FileList | File[] | null) => {
    const files = fileList ? Array.from(fileList) : [];
    if (files.length === 0) return;
    setError(null);
    setUploading(true);

    try {
      for (const file of files) {
        const fileId = crypto.randomUUID();
        const safeName = file.name.replace(/[^\w.\-() ]+/g, "_");
        const path = `${userId}/${fileId}/${safeName}`;

        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, {
            contentType: file.type || undefined,
            upsert: false,
          });
        if (upErr) throw new Error(`Upload failed: ${file.name}`);

        const { error: metaErr } = await supabase.from("files").insert({
          id: fileId,
          owner_id: userId,
          storage_path: path,
          file_name: file.name,
          mime_type: file.type || null,
          size_bytes: file.size,
        });

        if (metaErr) {
          await supabase.storage.from(BUCKET).remove([path]);
          throw new Error(`Failed to record metadata: ${file.name}`);
        }

        // 감사 로그는 화면 갱신을 막을 이유가 없다 — 응답을 기다리지 않는다
        // (브라우저 요청이라 페이지가 열려 있는 한 백그라운드에서 계속 전송된다).
        supabase.from("audit_logs").insert({
          user_id: userId,
          target_type: "file",
          target_id: fileId,
          action: "create",
        });
        const tags = extractTagsFromText(file.name);
        supabase.rpc("sync_object_tags", { p_kind: "file", p_id: fileId, p_tag_names: tags });
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  // ---- 드래그 앤 드롭 ----
  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files")) {
      dragDepth.current += 1;
      setDragOver(true);
    }
  };
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  };

  const download = (id: string) =>
    start(async () => {
      const res = await getSignedUrl(id);
      if ("url" in res) window.location.href = res.url;
      else setError(res.error);
    });

  const rename = (row: FileRow) =>
    start(async () => {
      const next = window.prompt("New file name", row.file_name);
      if (next == null || next.trim() === "" || next === row.file_name) return;
      const res = await renameFile(row.id, next);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  // 삭제는 GitHub 처럼 파일 이름을 직접 입력해야 확정된다(DeleteConfirmDialog).
  // 목록은 삭제 성공 후 router.refresh() 로 즉시 갱신한다.

  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{ position: "relative" }}
    >
      <div className="page-head">
        <div>
          <h1 className="page-h">Repository</h1>
        </div>
        <div className="row">
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => uploadFiles(e.target.files)}
          />
          <button
            className="btn btn-primary"
            onClick={onPick}
            disabled={uploading}
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      <div className="category-tabs">
        <span className="label" style={{ alignSelf: "center", marginRight: 4 }}>REPOSITORY</span>
        <button
          type="button"
          className={`category-tab ${repoFilter === "all" ? "active" : ""}`}
          onClick={() => selectRepo("all")}
        >
          All
        </button>
        <button
          type="button"
          className={`category-tab ${repoFilter === "null" ? "active" : ""}`}
          onClick={() => selectRepo("null")}
        >
          Null Repository
        </button>
        {repositories.map((r) => (
          <button
            type="button"
            key={r.id}
            className={`category-tab ${repoFilter === r.id ? "active" : ""}`}
            onClick={() => selectRepo(r.id)}
          >
            {r.name}
          </button>
        ))}
        <button type="button" className="category-tab" onClick={onNewRepo}>
          + New
        </button>
      </div>

      {repoContents && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-header">
            <span className="label">
              ITEMS IN {repoFilter === "null" ? "NULL REPOSITORY" : repositories.find((r) => r.id === repoFilter)?.name?.toUpperCase()}
            </span>
          </div>
          <div className="panel-body repo-contents">
            {(["documents", "code", "sheets", "mindmaps"] as const).map((group) => {
              const rows =
                group === "documents" ? repoContents.documents.map((d) => ({ id: d.id, label: d.title, kind: "document" as const }))
                : group === "code" ? repoContents.code.map((c) => ({ id: c.id, label: c.name, kind: "code" as const }))
                : group === "sheets" ? repoContents.sheets.map((sh) => ({ id: sh.id, label: sh.title, kind: "sheet" as const }))
                : repoContents.mindmaps.map((m) => ({ id: m.id, label: m.title, kind: "mindmap" as const }));
              if (rows.length === 0) return null;
              return (
                <div key={group} className="repo-group">
                  <span className="label">{group.toUpperCase()}</span>
                  <div className="repo-items">
                    {rows.map((item) => (
                      <OpenItemButton
                        key={item.id}
                        kind={item.kind}
                        id={item.id}
                        title={item.label}
                        className="btn btn-ghost btn-sm"
                      >
                        {item.label}
                      </OpenItemButton>
                    ))}
                  </div>
                </div>
              );
            })}
            {repoContents.documents.length + repoContents.code.length + repoContents.sheets.length + repoContents.mindmaps.length === 0 && (
              <span className="muted" style={{ fontSize: 12.5 }}>No docs, code, tables or link graphs in this repository yet — assign them from each editor's repository selector.</span>
            )}
          </div>
        </div>
      )}

      <div className="category-tabs">
        <button
          type="button"
          className={`category-tab ${category === "all" ? "active" : ""}`}
          onClick={() => setCategory("all")}
        >
          All ({initialFiles.length})
        </button>
        {(Object.keys(FILE_CATEGORY_LABEL) as FileCategory[])
          .filter((c) => (categoryCounts.get(c) ?? 0) > 0)
          .map((c) => (
            <button
              type="button"
              key={c}
              className={`category-tab ${category === c ? "active" : ""}`}
              onClick={() => setCategory(c)}
            >
              {FILE_CATEGORY_LABEL[c]} ({categoryCounts.get(c)})
            </button>
          ))}
      </div>

      <div className="panel">
        <div className="panel-header">
          <span className="label">
            FILES ({filtered.length}
            {query || category !== "all" || starredOnly ? ` / ${initialFiles.length}` : ""})
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
              placeholder="Search name or type…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        {initialFiles.length === 0 ? (
          <div className="empty">
            No files yet. Use “Upload” or drag & drop to get started.
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            {starredOnly && !query
              ? "No starred files."
              : `No files match${query ? ` “${query}”` : " this filter"}.`}
          </div>
        ) : (
          <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 34 }}></th>
                <th>Name</th>
                <th style={{ width: 120 }} className="col-hide-mobile">Type</th>
                <th style={{ width: 100 }}>Size</th>
                <th style={{ width: 160 }} className="col-hide-mobile">Uploaded</th>
                <th style={{ width: 60 }} className="col-hide-mobile">Owner</th>
                <th style={{ width: 280 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => {
                const owned = f.owner_id === userId;
                return (
                  <tr key={f.id}>
                    <td>
                      <StarButton
                        kind="file"
                        id={f.id}
                        initialStarred={starredSet.has(f.id)}
                        onChange={(v) => setStarred(f.id, v)}
                      />
                    </td>
                    <td>{f.file_name}</td>
                    <td className="mono muted col-hide-mobile" style={{ fontSize: 12 }}>
                      {f.mime_type || "—"}
                    </td>
                    <td className="mono muted">{formatBytes(f.size_bytes)}</td>
                    <td className="mono muted col-hide-mobile" style={{ fontSize: 12 }}>
                      {formatDate(f.created_at)}
                    </td>
                    <td className="col-hide-mobile">
                      <span className="badge">{owned ? "Mine" : "Shared"}</span>
                    </td>
                    <td>
                      <div className="row row-actions" style={{ gap: 4 }}>
                        {owned && (
                          <select
                            className="select repo-picker"
                            value={repoRows.get(f.id) ?? ""}
                            onChange={(e) => moveFileRepo(f.id, e.target.value)}
                            title="Repository"
                            aria-label="Repository"
                          >
                            <option value="">Null Repository</option>
                            {repositories.map((r) => (
                              <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                          </select>
                        )}
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => download(f.id)}
                          disabled={pending}
                        >
                          Download
                        </button>
                        {f.canEdit && (
                          <>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => rename(f)}
                              disabled={pending}
                            >
                              Rename
                            </button>
                            {owned && (
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => setShareTarget(f)}
                              >
                                Share
                              </button>
                            )}
                            <button
                              className="btn btn-ghost btn-sm btn-danger"
                              onClick={() => setDeleteTarget(f)}
                              disabled={pending}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {dragOver && (
        <div className="dropzone">
          <div className="dropzone-inner">
            <div className="dropzone-icon">⬇</div>
            Drop to upload
          </div>
        </div>
      )}

      {shareTarget && (
        <ShareDialog
          targetLabel={shareTarget.file_name}
          myShareId={userId}
          loadShares={() => listFileShares(shareTarget.id)}
          onShare={(rid, perm) => shareFile(shareTarget.id, rid, perm)}
          onRevoke={(pid) => revokeFileShare(pid)}
          onClose={() => setShareTarget(null)}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmDialog
          itemKind="file"
          itemLabel={deleteTarget.file_name}
          onConfirm={() => deleteFile(deleteTarget.id)}
          onDeleted={() => router.refresh()}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      <style>{dropCss}</style>
    </div>
  );
}

const dropCss = `
.dropzone {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(0,0,0,0.72);
  display: flex; align-items: center; justify-content: center;
  pointer-events: none;
}
.dropzone-inner {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 40px 64px;
  border: 2px dashed var(--border-2);
  border-radius: var(--radius-lg);
  background: var(--bg-2);
  color: var(--text-1);
  font-size: 14px;
}
.dropzone-icon { font-size: 26px; color: var(--accent); }
`;
