"use client";

import { useMemo, useRef, useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { formatBytes } from "@/lib/format";
import { startUploads, useUploads } from "../uploads/upload-store";
import { ShareDialog } from "@/components/share-dialog";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { Modal } from "@/components/modal";
import { FilePreview, previewMode, type PreviewTarget } from "@/components/file-preview";
import { StarButton } from "../star-button";
import { SendToChatButton } from "../send-to-chat-button";
import { getPreviewUrl } from "../sharing/actions";
import { triggerDownload } from "@/lib/download-file";
import {
  IconDocuments,
  IconCode,
  IconSheet,
  IconMindmap,
  IconFiles,
  IconDownload,
  IconChevronLeft,
  IconChevronRight,
  IconEye,
  IconPlus,
} from "../icons";
import { Tooltip } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { RepositoryGraph } from "../repositories/repository-graph";
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
  renameRepository,
  deleteRepository,
  moveRepository,
  type Repository,
  type RepositoryEntry,
  type RepoEntryKind,
} from "../repositories/actions";
import { OpenItemButton } from "../workspace/open-item-button";
import { useWorkspace, type TabKind } from "../workspace/workspace-context";
import { createDocumentTab } from "../documents/actions";
import { createSheetTab } from "../sheets/actions";
import { createMindMapTab } from "../mindmap/actions";

const KIND_ICON: Record<RepoEntryKind, (p: { size?: number }) => React.ReactElement> = {
  folder: IconFiles,
  document: IconDocuments,
  code: IconCode,
  sheet: IconSheet,
  mindmap: IconMindmap,
  file: IconFiles,
};
const KIND_LABEL: Record<RepoEntryKind, string> = {
  folder: "Folder",
  document: "Doc",
  code: "Code",
  sheet: "Table",
  mindmap: "Link Graph",
  file: "File",
};
const OPENABLE = new Set<RepoEntryKind>(["document", "code", "sheet", "mindmap"]);

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
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploading, completedTick } = useUploads();
  const { openTab } = useWorkspace();
  const [error, setError] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<FileRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileRow | null>(null);
  const [query, setQuery] = useState("");
  const [starredSet, setStarredSet] = useState(() => new Set(starredIds));
  const [dragOver, setDragOver] = useState(false);
  // 저장소/폴더 뷰 — null 이면 랜딩(최상위 저장소 카드), "null" 은 Null
  // Repository 상세, 그 외는 해당 저장소/폴더 id 의 상세(중첩 가능).
  const [repoView, setRepoView] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "graph">("list");
  const [repoContents, setRepoContents] = useState<RepositoryEntry[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [repoDialog, setRepoDialog] = useState<
    { mode: "create" | "rename"; id?: string; name: string; parentId?: string | null } | null
  >(null);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const dragDepth = useRef(0);
  const [pending, start] = useTransition();

  const filesById = useMemo(() => new Map(initialFiles.map((f) => [f.id, f])), [initialFiles]);
  const reposById = useMemo(() => new Map(repositories.map((r) => [r.id, r])), [repositories]);

  const setStarred = (id: string, starred: boolean) => {
    setStarredSet((prev) => {
      const next = new Set(prev);
      if (starred) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const onPick = () => inputRef.current?.click();

  // 현재 폴더까지의 경로 — 이미 불러온 전체 저장소 목록(부모 포함)을 거슬러
  // 올라가며 계산한다. 저장소 개수가 방대하지 않은 한(개인/팀 워크스페이스라
  // 현실적으로 아니다) 레벨마다 서버를 왕복할 이유가 없다.
  const breadcrumb = useMemo(() => {
    if (repoView === null) return [];
    if (repoView === "null") return [{ id: "null", name: "Null Repository" }];
    const chain: { id: string; name: string }[] = [];
    let cursor: string | null = repoView;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor)) {
      guard.add(cursor);
      const r = reposById.get(cursor);
      if (!r) break;
      chain.unshift({ id: r.id, name: r.name });
      cursor = r.parentId;
    }
    return chain;
  }, [repoView, reposById]);

  const topLevel = useMemo(() => repositories.filter((r) => !r.parentId), [repositories]);

  const openRepo = (value: string) => {
    setRepoView(value);
    setViewMode("list");
    setRepoContents(null);
    listRepositoryContents(value === "null" ? null : value).then(setRepoContents);
  };
  const backToLanding = () => {
    setRepoView(null);
    setRepoContents(null);
  };

  const submitRepoDialog = async () => {
    if (!repoDialog) return;
    const name = repoDialog.name.trim();
    if (!name) return;
    const res =
      repoDialog.mode === "create"
        ? await createRepository(name, repoDialog.parentId ?? null)
        : await renameRepository(repoDialog.id!, name);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setRepoDialog(null);
    router.refresh();
    if (repoDialog.mode === "create" && repoView !== null) reloadContents();
  };

  const reloadContents = () => {
    if (repoView === null) return;
    listRepositoryContents(repoView === "null" ? null : repoView).then(setRepoContents);
  };

  const onDeleteRepo = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? Items inside are NOT deleted — they return to the Null Repository, and any sub-folders move up a level.`)) return;
    const res = await deleteRepository(id);
    if ("error" in res) setError(res.error);
    else {
      router.refresh();
      reloadContents();
    }
  };

  const onNewItem = async (kind: "document" | "sheet" | "code" | "mindmap") => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      let id = "";
      let title = "";
      let seed: unknown;
      if (kind === "document") {
        const r = await createDocumentTab();
        id = r.id; title = r.title; seed = r.seed;
      } else if (kind === "sheet") {
        const r = await createSheetTab();
        id = r.id; title = r.title; seed = r.seed;
      } else if (kind === "code") {
        setError("Code files live inside a Code Space — create one from Codespace.");
        return;
      } else {
        const r = await createMindMapTab();
        id = r.id; title = r.title; seed = r.seed;
      }
      if (repoView && repoView !== "null") {
        await setItemRepository(kind, id, repoView);
      }
      reloadContents();
      openTab(kind, id, title, seed);
    } catch {
      setError("Failed to create the item.");
    } finally {
      setCreating(false);
    }
  };

  // 항목/폴더를 다른 저장소·폴더로 옮긴다. 대부분의 경우 옮긴 즉시 지금 보는
  // 폴더에서는 사라지므로 목록을 다시 불러온다.
  const moveEntry = async (row: RepositoryEntry, value: string) => {
    const target = value === "" ? null : value;
    const res =
      row.kind === "folder"
        ? await moveRepository(row.id, target)
        : await setItemRepository(row.kind, row.id, target);
    if ("error" in res) setError(res.error);
    else {
      reloadContents();
      router.refresh();
    }
  };

  const uploadFiles = (fileList: FileList | File[] | null) => {
    const files = fileList ? Array.from(fileList) : [];
    if (files.length === 0) return;
    setError(null);
    startUploads(files, {
      userId,
      repositoryId: repoView && repoView !== "null" ? repoView : null,
    });
    if (inputRef.current) inputRef.current.value = "";
  };

  useEffect(() => {
    if (completedTick > 0 && !uploading) {
      router.refresh();
      reloadContents();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedTick, uploading, router]);

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
      if ("url" in res) triggerDownload(res.url);
      else setError(res.error);
    });

  const openPreview = (f: FileRow) =>
    setPreviewTarget({ id: f.id, name: f.file_name, mime: f.mime_type, size: f.size_bytes });

  const rename = (row: RepositoryEntry) => setRenameTarget({ id: row.id, name: row.label });

  const submitRename = () => {
    if (!renameTarget) return;
    const next = renameTarget.name.trim();
    if (!next) return;
    start(async () => {
      const res = await renameFile(renameTarget.id, next);
      if (!res.ok) setError(res.error);
      else {
        setRenameTarget(null);
        reloadContents();
        router.refresh();
      }
    });
  };

  // repoContents(kind/id/label 만 있는 요약)와 initialFiles(전체 메타데이터)
  // 를 합쳐 file 종류 행에 미리보기/다운로드/공유에 필요한 정보를 채운다 —
  // 목록 조회를 하나 더 하지 않고 이미 페이지 로드 때 받아 온 것을 쓴다.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (repoContents ?? [])
      .filter((r) => !q || r.label.toLowerCase().includes(q))
      .map((r) => ({ ...r, file: r.kind === "file" ? filesById.get(r.id) : undefined }));
  }, [repoContents, query, filesById]);

  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{ position: "relative" }}
    >
      {error && <div className="notice notice-error">{error}</div>}

      {repoView === null ? (
        /* ================= 랜딩 — 최상위 저장소 카드 ================= */
        <>
          <div className="page-head">
            <div>
              <h1 className="page-h">Repositories</h1>
              <p className="page-sub">
                Docs, tables, code, link graphs and files — organized into
                folders. Open one to view as a list or as a graph.
              </p>
            </div>
            <Tooltip content="New repository">
              <button
                className="btn btn-primary btn-icon"
                onClick={() => setRepoDialog({ mode: "create", name: "", parentId: null })}
                aria-label="New repository"
              >
                <IconPlus size={16} />
              </button>
            </Tooltip>
          </div>
          <div className="panel">
            <div className="panel-header">
              <span className="label">REPOSITORIES ({topLevel.length + 1})</span>
            </div>
            <div className="table-scroll">
              <table className="table drive-table">
                <thead>
                  <tr>
                    <th style={{ width: 34 }}></th>
                    <th>Name</th>
                    <th style={{ width: 200 }}></th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="drive-row clickable" onClick={() => openRepo("null")}>
                    <td>
                      <span className="drive-icon folder">
                        <IconFiles size={16} />
                      </span>
                    </td>
                    <td className="table-cell-title">
                      <span className="drive-name">Null Repository</span>
                      <span className="drive-sub">Unfiled items</span>
                    </td>
                    <td></td>
                  </tr>
                  {topLevel.map((r) => (
                    <tr key={r.id} className="drive-row" onClick={() => openRepo(r.id)}>
                      <td>
                        <span className="drive-icon folder">
                          <IconFiles size={16} />
                        </span>
                      </td>
                      <td className="table-cell-title">
                        <span className="drive-name">{r.name}</span>
                      </td>
                      <td>
                        <div className="row row-actions" style={{ gap: 4, justifyContent: "flex-end" }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRepoDialog({ mode: "rename", id: r.id, name: r.name });
                            }}
                          >
                            Rename
                          </button>
                          <button
                            className="btn btn-ghost btn-sm btn-danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteRepo(r.id, r.name);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        /* ================= 저장소/폴더 상세 ================= */
        <>
          <div className="page-head">
            <div className="row" style={{ gap: 6, minWidth: 0, flexWrap: "wrap" }}>
              <button className="btn btn-sm" onClick={backToLanding}>
                <IconChevronLeft size={13} /> Repositories
              </button>
              {breadcrumb.map((b, i) => (
                <span key={b.id} className="row" style={{ gap: 6, alignItems: "center" }}>
                  <span className="dim"><IconChevronRight size={11} /></span>
                  {i === breadcrumb.length - 1 ? (
                    <span className="page-h" style={{ fontSize: 18 }}>{b.name}</span>
                  ) : (
                    <button className="btn btn-ghost btn-sm" onClick={() => openRepo(b.id)}>
                      {b.name}
                    </button>
                  )}
                </span>
              ))}
            </div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {repoView !== "null" && (
                <div className="view-switch" role="group" aria-label="View">
                  <span
                    className={`view-switch-label ${viewMode === "list" ? "active" : ""}`}
                    onClick={() => setViewMode("list")}
                  >
                    List
                  </span>
                  <Switch
                    checked={viewMode === "graph"}
                    onCheckedChange={(v) => setViewMode(v ? "graph" : "list")}
                  />
                  <span
                    className={`view-switch-label ${viewMode === "graph" ? "active" : ""}`}
                    onClick={() => setViewMode("graph")}
                  >
                    Graph
                  </span>
                </div>
              )}
              <button className="btn btn-sm" disabled={creating} onClick={() => onNewItem("document")}>+ Doc</button>
              <button className="btn btn-sm" disabled={creating} onClick={() => onNewItem("sheet")}>+ Table</button>
              <button className="btn btn-sm" disabled={creating} onClick={() => onNewItem("mindmap")}>+ Link Graph</button>
              {repoView !== "null" && (
                <button
                  className="btn btn-sm"
                  onClick={() => setRepoDialog({ mode: "create", name: "", parentId: repoView })}
                >
                  + Folder
                </button>
              )}
              <input ref={inputRef} type="file" multiple hidden onChange={(e) => uploadFiles(e.target.files)} />
              <span className="btn-group-sep" aria-hidden="true" />
              <Tooltip content={uploading ? "Uploading…" : "Upload file"}>
                <button
                  className="btn btn-primary btn-sm btn-icon"
                  onClick={onPick}
                  disabled={uploading}
                  aria-label={uploading ? "Uploading…" : "Upload file"}
                >
                  <IconPlus size={15} />
                </button>
              </Tooltip>
            </div>
          </div>

          {viewMode === "graph" && repoView !== "null" ? (
            <RepositoryGraph
              repositoryId={repoView}
              onNavigateFolder={openRepo}
              onOpenFile={(id) => {
                const f = filesById.get(id);
                if (f) openPreview(f);
              }}
            />
          ) : (
            <div className="panel">
              <div className="panel-header">
                <span className="label">
                  ITEMS ({rows.length}
                  {query ? ` / ${repoContents?.length ?? 0}` : ""})
                </span>
                <input
                  className="input"
                  style={{ width: 240, height: 30 }}
                  placeholder="Search this folder…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {repoContents === null ? (
                <div className="empty" style={{ padding: 20 }}>Loading…</div>
              ) : rows.length === 0 ? (
                <div className="empty">
                  {query
                    ? `No items match "${query}".`
                    : "Empty — create something above, upload a file, or drag & drop."}
                </div>
              ) : (
                <div className="table-scroll">
                  <table className="table drive-table">
                    <thead>
                      <tr>
                        <th style={{ width: 34 }}></th>
                        <th>Name</th>
                        <th style={{ width: 90 }}>Type</th>
                        <th style={{ width: 90 }}>Size</th>
                        <th style={{ width: 150 }}>Move to</th>
                        <th style={{ width: 220 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const Icon = KIND_ICON[row.kind];
                        const f = row.file;
                        const owned = f ? f.owner_id === userId : true;
                        return (
                          <tr key={`${row.kind}:${row.id}`} className={row.kind === "folder" ? "drive-row clickable" : "drive-row"} onClick={row.kind === "folder" ? () => openRepo(row.id) : undefined}>
                            <td>
                              {row.kind === "file" ? (
                                <StarButton
                                  kind="file"
                                  id={row.id}
                                  initialStarred={starredSet.has(row.id)}
                                  onChange={(v) => setStarred(row.id, v)}
                                />
                              ) : (
                                <span className={`drive-icon ${row.kind}`}>
                                  <Icon size={16} />
                                </span>
                              )}
                            </td>
                            <td className="table-cell-title">
                              {row.kind === "folder" ? (
                                <span className="drive-name">{row.label}</span>
                              ) : row.kind === "file" ? (
                                previewMode(row.label, f?.mime_type ?? null) === "none" ? (
                                  row.label
                                ) : (
                                  <button className="link-btn" onClick={() => f && openPreview(f)} title="Preview without downloading">
                                    {row.label}
                                  </button>
                                )
                              ) : (
                                <OpenItemButton kind={row.kind as TabKind} id={row.id} title={row.label} className="link-btn">
                                  {row.label || "Untitled"}
                                </OpenItemButton>
                              )}
                            </td>
                            <td data-label="Type">
                              <span className="badge">{KIND_LABEL[row.kind]}</span>
                            </td>
                            <td className="mono muted" data-label="Size">
                              {row.kind === "file" ? formatBytes(f?.size_bytes ?? null) : "—"}
                            </td>
                            <td data-label="Move to" onClick={(e) => e.stopPropagation()}>
                              <select
                                className="select repo-picker"
                                value=""
                                onChange={(e) => {
                                  if (!e.target.value) return;
                                  moveEntry(row, e.target.value === "__null__" ? "" : e.target.value);
                                }}
                                title="Move to…"
                                aria-label="Move to"
                              >
                                <option value="">Move to…</option>
                                <option value="__null__">Null Repository</option>
                                {repositories
                                  .filter((r) => r.id !== row.id)
                                  .map((r) => (
                                    <option key={r.id} value={r.id}>{r.name}</option>
                                  ))}
                              </select>
                            </td>
                            <td onClick={(e) => e.stopPropagation()}>
                              <div className="row row-actions" style={{ gap: 4, justifyContent: "flex-end" }}>
                                {row.kind === "folder" ? (
                                  <>
                                    <button className="btn btn-ghost btn-sm" onClick={() => setRepoDialog({ mode: "rename", id: row.id, name: row.label })}>
                                      Rename
                                    </button>
                                    <button className="btn btn-ghost btn-sm btn-danger" onClick={() => onDeleteRepo(row.id, row.label)}>
                                      Delete
                                    </button>
                                  </>
                                ) : row.kind === "file" && f ? (
                                  <>
                                    {previewMode(f.file_name, f.mime_type) !== "none" && (
                                      <button className="btn btn-ghost btn-sm" onClick={() => openPreview(f)} title="Preview without downloading">
                                        <IconEye size={13} /> Preview
                                      </button>
                                    )}
                                    <SendToChatButton kind="file" id={f.id} title={f.file_name} canGrant={owned} label="Chat" />
                                    <button className="btn btn-ghost btn-sm" onClick={() => download(f.id)} disabled={pending}>
                                      Download
                                    </button>
                                    {f.canEdit && (
                                      <>
                                        <button className="btn btn-ghost btn-sm" onClick={() => rename(row)} disabled={pending}>
                                          Rename
                                        </button>
                                        {owned && (
                                          <button className="btn btn-ghost btn-sm" onClick={() => setShareTarget(f)}>
                                            Share
                                          </button>
                                        )}
                                        <button className="btn btn-ghost btn-sm btn-danger" onClick={() => setDeleteTarget(f)} disabled={pending}>
                                          Delete
                                        </button>
                                      </>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    <OpenItemButton kind={row.kind as TabKind} id={row.id} title={row.label} className="btn btn-ghost btn-sm">
                                      Open
                                    </OpenItemButton>
                                    <SendToChatButton kind={row.kind} id={row.id} title={row.label || "Untitled"} label="Chat" />
                                    {repoView !== "null" && OPENABLE.has(row.kind) && (
                                      <button
                                        className="btn btn-ghost btn-sm"
                                        title="Remove from this folder (moves to Null Repository)"
                                        onClick={() => moveEntry(row, "")}
                                      >
                                        Remove
                                      </button>
                                    )}
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
          )}
        </>
      )}

      {dragOver && (
        <div className="dropzone">
          <div className="dropzone-inner">
            <div className="dropzone-icon"><IconDownload size={26} /></div>
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
          onDeleted={() => {
            router.refresh();
            reloadContents();
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {previewTarget && (
        <FilePreview
          target={previewTarget}
          loadUrl={getPreviewUrl}
          onDownload={() => download(previewTarget.id)}
          onClose={() => setPreviewTarget(null)}
        />
      )}

      {renameTarget && (
        <Modal title="Rename file" onClose={() => setRenameTarget(null)}>
          <input
            className="input"
            autoFocus
            placeholder="File name"
            value={renameTarget.name}
            onChange={(e) => setRenameTarget((t) => (t ? { ...t, name: e.target.value } : t))}
            onKeyDown={(e) => e.key === "Enter" && submitRename()}
            style={{ marginBottom: 12 }}
          />
          <button className="btn btn-primary btn-block" onClick={submitRename} disabled={!renameTarget.name.trim() || pending}>
            {pending ? "Renaming…" : "Save"}
          </button>
        </Modal>
      )}

      {repoDialog && (
        <Modal
          title={
            repoDialog.mode === "rename"
              ? "Rename"
              : repoDialog.parentId
                ? "New folder"
                : "New repository"
          }
          onClose={() => setRepoDialog(null)}
        >
          <input
            className="input"
            autoFocus
            placeholder="Name"
            value={repoDialog.name}
            maxLength={80}
            onChange={(e) => setRepoDialog((d) => (d ? { ...d, name: e.target.value } : d))}
            onKeyDown={(e) => e.key === "Enter" && submitRepoDialog()}
            style={{ marginBottom: 12 }}
          />
          <button className="btn btn-primary btn-block" onClick={submitRepoDialog} disabled={!repoDialog.name.trim()}>
            {repoDialog.mode === "create" ? "Create" : "Save"}
          </button>
        </Modal>
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
