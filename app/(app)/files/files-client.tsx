"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatBytes, formatDate } from "@/lib/format";
import { getFileCategory, FILE_CATEGORY_LABEL, type FileCategory } from "@/lib/file-category";
import { extractTagsFromText } from "@/lib/tags";
import { ShareDialog } from "@/components/share-dialog";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { Modal } from "@/components/modal";
import { StarButton } from "../star-button";
import { IconDocuments, IconCode, IconSheet, IconMindmap, IconFiles } from "../icons";

const KIND_ICON = {
  document: IconDocuments,
  code: IconCode,
  sheet: IconSheet,
  mindmap: IconMindmap,
} as const;
const KIND_LABEL = {
  document: "Doc",
  code: "Code",
  sheet: "Table",
  mindmap: "Link Graph",
} as const;
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
  type Repository,
  type RepositoryContents,
} from "../repositories/actions";
import { OpenItemButton } from "../workspace/open-item-button";
import { useWorkspace } from "../workspace/workspace-context";
import { createDocumentTab } from "../documents/actions";
import { createCodeFileTab } from "../code/actions";
import { createSheetTab } from "../sheets/actions";
import { createMindMapTab } from "../mindmap/actions";

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
  // 저장소 뷰 — null 이면 랜딩(모든 저장소 카드), "null" 은 Null Repository
  // 상세, 그 외는 해당 repo id 상세.
  const [repoView, setRepoView] = useState<string | null>(null);
  const [repoRows, setRepoRows] = useState<Map<string, string | null>>(
    () => new Map(initialFiles.map((f) => [f.id, f.repository_id]))
  );
  const [repoContents, setRepoContents] = useState<RepositoryContents | null>(null);
  const [unfiled, setUnfiled] = useState<RepositoryContents | null>(null);
  const [creating, setCreating] = useState(false);
  // 저장소 생성/이름변경 다이얼로그(prompt 는 Tauri 웹뷰에서 동작하지 않으므로
  // 모달 입력을 쓴다).
  const [repoDialog, setRepoDialog] = useState<{ mode: "create" | "rename"; id?: string; name: string } | null>(null);
  // 파일 이름변경 모달(prompt 는 Tauri 웹뷰에서 동작하지 않음).
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
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
        if (repoView === null) return false; // 랜딩에서는 파일 표를 쓰지 않는다
        const rid = repoRows.get(f.id) ?? null;
        return repoView === "null" ? rid === null : rid === repoView;
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
  }, [categorized, query, category, starredOnly, starredSet, repoView, repoRows]);

  // 저장소 상세로 진입 — 해당 저장소의 문서/코드/시트/마인드맵 목록을 불러온다.
  const openRepo = (value: string) => {
    setRepoView(value);
    setRepoContents(null);
    listRepositoryContents(value === "null" ? null : value).then(setRepoContents);
    // 상세에서 "Unfiled 에서 추가" 픽커용 미분류 목록도 준비
    if (value !== "null") listRepositoryContents(null).then(setUnfiled);
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
        ? await createRepository(name)
        : await renameRepository(repoDialog.id!, name);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setRepoDialog(null);
    router.refresh();
  };

  const { openTab } = useWorkspace();

  const reloadContents = () => {
    if (repoView === null) return;
    listRepositoryContents(repoView === "null" ? null : repoView).then(setRepoContents);
    if (repoView !== "null") listRepositoryContents(null).then(setUnfiled);
  };

  const onDeleteRepo = async (id: string, name: string) => {
    if (!confirm(`Delete repository "${name}"? Items inside are NOT deleted — they return to the Null Repository.`)) return;
    const res = await deleteRepository(id);
    if ("error" in res) setError(res.error);
    else router.refresh();
  };

  // 이 저장소 안에서 새 Mobil 아이템 생성 → 저장소 귀속 → 에디터 탭으로 열기
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
        const r = await createCodeFileTab();
        id = r.id; title = r.title; seed = r.seed;
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

  const removeItemFromRepo = async (kind: "document" | "sheet" | "code" | "mindmap", id: string) => {
    const res = await setItemRepository(kind, id, null);
    if ("error" in res) setError(res.error);
    else reloadContents();
  };

  const addUnfiledItem = async (value: string) => {
    if (!value || !repoView || repoView === "null") return;
    const [kind, id] = value.split(":") as ["document" | "sheet" | "code" | "mindmap", string];
    const res = await setItemRepository(kind, id, repoView);
    if ("error" in res) setError(res.error);
    else reloadContents();
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
          // 저장소 상세에서 업로드하면 그 저장소로 바로 귀속된다.
          repository_id: repoView && repoView !== "null" ? repoView : null,
        });
        setRepoRows((m) => new Map(m).set(fileId, repoView && repoView !== "null" ? repoView : null));

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
      if ("url" in res) {
        // window.location.href 는 하드 네비게이션 — 데스크톱(Tauri 웹뷰)에서는
        // 앱 화면 자체가 서명 URL 로 이동해버린다. 앵커 클릭으로 다운로드만
        // 트리거한다(웹/데스크톱 동일 동작).
        const a = document.createElement("a");
        a.href = res.url;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else setError(res.error);
    });

  const rename = (row: FileRow) => setRenameTarget({ id: row.id, name: row.file_name });

  const submitRename = () => {
    if (!renameTarget) return;
    const next = renameTarget.name.trim();
    if (!next) return;
    start(async () => {
      const res = await renameFile(renameTarget.id, next);
      if (!res.ok) setError(res.error);
      else {
        setRenameTarget(null);
        router.refresh();
      }
    });
  };

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
      {error && <div className="notice notice-error">{error}</div>}

      {repoView === null ? (
        /* ================= 랜딩 — 모든 저장소 카드 ================= */
        <>
          <div className="page-head">
            <div>
              <h1 className="page-h">Repositories</h1>
              <p className="page-sub">
                Docs, tables, code, link graphs and files — organized into
                repositories. Open one to view, add or remove its items.
              </p>
            </div>
            <button className="btn btn-primary" onClick={() => setRepoDialog({ mode: "create", name: "" })}>
              + New repository
            </button>
          </div>
          <div className="panel">
            <div className="panel-header">
              <span className="label">REPOSITORIES ({repositories.length + 1})</span>
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
                    <td>
                      <span className="drive-name">Null Repository</span>
                      <span className="drive-sub">Unfiled items</span>
                    </td>
                    <td></td>
                  </tr>
                  {repositories.map((r) => (
                    <tr key={r.id} className="drive-row" onClick={() => openRepo(r.id)}>
                      <td>
                        <span className="drive-icon folder">
                          <IconFiles size={16} />
                        </span>
                      </td>
                      <td>
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
        /* ================= 저장소 상세 ================= */
        <>
          <div className="page-head">
            <div className="row" style={{ gap: 10, minWidth: 0 }}>
              <button className="btn btn-sm" onClick={backToLanding}>
                ← Repositories
              </button>
              <h1 className="page-h" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {repoView === "null"
                  ? "Null Repository"
                  : repositories.find((r) => r.id === repoView)?.name}
              </h1>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <button className="btn btn-sm" disabled={creating} onClick={() => onNewItem("document")}>+ Doc</button>
              <button className="btn btn-sm" disabled={creating} onClick={() => onNewItem("sheet")}>+ Table</button>
              <button className="btn btn-sm" disabled={creating} onClick={() => onNewItem("code")}>+ Code</button>
              <button className="btn btn-sm" disabled={creating} onClick={() => onNewItem("mindmap")}>+ Link Graph</button>
              {repoView !== "null" && (
                <select
                  className="select repo-picker"
                  value=""
                  onChange={(e) => addUnfiledItem(e.target.value)}
                  title="Add an unfiled item to this repository"
                >
                  <option value="">Add from Unfiled…</option>
                  {unfiled?.documents.map((d) => (
                    <option key={d.id} value={`document:${d.id}`}>[doc] {d.title}</option>
                  ))}
                  {unfiled?.sheets.map((sh) => (
                    <option key={sh.id} value={`sheet:${sh.id}`}>[table] {sh.title}</option>
                  ))}
                  {unfiled?.code.map((c) => (
                    <option key={c.id} value={`code:${c.id}`}>[code] {c.name}</option>
                  ))}
                  {unfiled?.mindmaps.map((m) => (
                    <option key={m.id} value={`mindmap:${m.id}`}>[graph] {m.title}</option>
                  ))}
                </select>
              )}
              <input
                ref={inputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => uploadFiles(e.target.files)}
              />
              <button className="btn btn-primary btn-sm" onClick={onPick} disabled={uploading}>
                {uploading ? "Uploading…" : "Upload file"}
              </button>
            </div>
          </div>

          {repoContents && (() => {
            const items = [
              ...repoContents.documents.map((d) => ({ id: d.id, label: d.title, kind: "document" as const })),
              ...repoContents.sheets.map((sh) => ({ id: sh.id, label: sh.title, kind: "sheet" as const })),
              ...repoContents.code.map((c) => ({ id: c.id, label: c.name, kind: "code" as const })),
              ...repoContents.mindmaps.map((m) => ({ id: m.id, label: m.title, kind: "mindmap" as const })),
            ];
            return (
              <div className="panel" style={{ marginBottom: 14 }}>
                <div className="panel-header">
                  <span className="label">MOBIL ITEMS ({items.length})</span>
                </div>
                {items.length === 0 ? (
                  <div className="empty">
                    No docs, tables, code or link graphs yet — create one above, or add from Unfiled.
                  </div>
                ) : (
                  <div className="table-scroll">
                    <table className="table drive-table">
                      <thead>
                        <tr>
                          <th style={{ width: 34 }}></th>
                          <th>Name</th>
                          <th style={{ width: 90 }}>Type</th>
                          <th style={{ width: 150 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => {
                          const Icon = KIND_ICON[item.kind];
                          return (
                            <tr key={`${item.kind}:${item.id}`} className="drive-row">
                              <td>
                                <span className={`drive-icon ${item.kind}`}>
                                  <Icon size={16} />
                                </span>
                              </td>
                              <td>
                                <OpenItemButton kind={item.kind} id={item.id} title={item.label} className="link-btn">
                                  {item.label || "Untitled"}
                                </OpenItemButton>
                              </td>
                              <td>
                                <span className="badge">{KIND_LABEL[item.kind]}</span>
                              </td>
                              <td>
                                <div className="row row-actions" style={{ gap: 4, justifyContent: "flex-end" }}>
                                  <OpenItemButton kind={item.kind} id={item.id} title={item.label} className="btn btn-ghost btn-sm">
                                    Open
                                  </OpenItemButton>
                                  {repoView !== "null" && (
                                    <button
                                      className="btn btn-ghost btn-sm"
                                      title="Remove from this repository (moves to Null Repository)"
                                      onClick={() => removeItemFromRepo(item.kind, item.id)}
                                    >
                                      Remove
                                    </button>
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
            );
          })()}

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

        </>
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
          <button
            className="btn btn-primary btn-block"
            onClick={submitRename}
            disabled={!renameTarget.name.trim() || pending}
          >
            {pending ? "Renaming…" : "Save"}
          </button>
        </Modal>
      )}

      {repoDialog && (
        <Modal
          title={repoDialog.mode === "create" ? "New repository" : "Rename repository"}
          onClose={() => setRepoDialog(null)}
        >
          <input
            className="input"
            autoFocus
            placeholder="Repository name"
            value={repoDialog.name}
            maxLength={80}
            onChange={(e) => setRepoDialog((d) => (d ? { ...d, name: e.target.value } : d))}
            onKeyDown={(e) => e.key === "Enter" && submitRepoDialog()}
            style={{ marginBottom: 12 }}
          />
          <button
            className="btn btn-primary btn-block"
            onClick={submitRepoDialog}
            disabled={!repoDialog.name.trim()}
          >
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
