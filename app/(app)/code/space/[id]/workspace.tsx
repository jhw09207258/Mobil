"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { MonacoApi } from "@/components/monaco/monaco-editor";
import { isLangKey, type LangKey } from "@/lib/languages";
import { Modal } from "@/components/modal";
import {
  addCodeFileToRepo,
  createSpaceFile,
  deleteSpaceFile,
  listCodeRepoFiles,
  readSpaceFile,
  renameSpaceFile,
  renameSpaceFolder,
  writeSpaceFile,
  type CodeRepoFile,
} from "../../repo-actions";
import { GithubPushDialog, VercelDeployDialog } from "./ship-dialogs";
import { buildTree, fuzzyMatch, type TreeNode } from "./tree-utils";

// ============================================================================
// Code Space 워크스페이스 — VS Code 식 편집기.
//
// 갖춘 것: 여러 파일 탭, 빠른 열기(Cmd+P), 트리에서 파일 만들기/이름변경/삭제,
// 저장 전 diff 검토, Cmd+S 저장. 찾기·바꾸기(Cmd+F/H), 명령 팔레트(F1),
// 멀티커서, 코드 접기, 자동완성은 Monaco 가 그대로 제공한다.
//
// 폴더는 실체가 없다 — 경로에 내포돼 있을 뿐이다. 그래서 "빈 폴더 만들기"는
// 없고, 폴더 이름 변경은 그 아래 파일들의 경로 접두사를 바꾸는 일이다.
// ============================================================================

/** 텍스트 소스만 다루므로 큰 파일은 거른다(바이너리 방지). */
const MAX_UPLOAD_BYTES = 200 * 1024;

// Monaco 는 1MB 가 넘는다. 정적으로 import 하면 Code Space 를 열기도 전에
// 전부 받아야 하므로, 파일을 열 때만 지연 로딩한다.
const MonacoCodeEditor = dynamic(
  () => import("@/components/monaco/monaco-editor").then((m) => m.MonacoCodeEditor),
  { ssr: false, loading: () => <div className="empty">Loading editor…</div> }
);
const MonacoDiff = dynamic(
  () => import("@/components/monaco/monaco-editor").then((m) => m.MonacoDiff),
  { ssr: false, loading: () => <div className="empty">Loading diff…</div> }
);

type Node = TreeNode<CodeRepoFile>;

/** 열려 있는 탭. saved 는 디스크 상태 — dirty 판정과 diff 의 기준이다. */
type Tab = {
  id: string;
  path: string;
  content: string;
  saved: string;
  language: LangKey;
};

export function CodeSpaceWorkspace({
  spaceId,
  spaceName,
  initialFiles,
  github,
}: {
  spaceId: string;
  spaceName: string;
  initialFiles: CodeRepoFile[];
  github: { owner: string | null; repo: string | null };
}) {
  const router = useRouter();
  const [files, setFiles] = useState(initialFiles);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<
    | { kind: "new"; prefix?: string }
    | { kind: "rename"; file: CodeRepoFile }
    | { kind: "renameFolder"; path: string }
    | { kind: "github" }
    | { kind: "deploy" }
    | null
  >(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiRef = useRef<MonacoApi | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const tabsRef = useRef<Tab[]>([]);
  tabsRef.current = tabs;

  const tree = useMemo(() => buildTree(files), [files]);
  const active = tabs.find((t) => t.id === activeId) ?? null;
  const dirtyCount = tabs.filter((t) => t.content !== t.saved).length;

  const refreshFiles = useCallback(async () => {
    const next = await listCodeRepoFiles(spaceId);
    setFiles(next);
    return next;
  }, [spaceId]);

  // ---- 탭 ----
  const openFile = useCallback(
    async (file: CodeRepoFile) => {
      const path = file.path || file.name;
      if (tabsRef.current.some((t) => t.id === file.id)) {
        setActiveId(file.id);
        setShowDiff(false);
        return;
      }
      setLoading(true);
      const res = await readSpaceFile(file.id);
      setLoading(false);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      const lang = isLangKey(res.language) ? res.language : "plaintext";
      setTabs((prev) => [
        ...prev,
        { id: file.id, path, content: res.content, saved: res.content, language: lang },
      ]);
      setActiveId(file.id);
      setShowDiff(false);
    },
    []
  );

  const save = useCallback(async (id: string) => {
    const tab = tabsRef.current.find((t) => t.id === id);
    if (!tab || tab.content === tab.saved) return;
    const body = tab.content;
    const res = await writeSpaceFile(id, body);
    if ("error" in res) setError(res.error);
    // 저장 중에 더 타이핑했을 수 있으므로, 저장한 내용만 saved 로 승격한다.
    else setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, saved: body } : t)));
  }, []);

  const saveAll = useCallback(async () => {
    for (const t of tabsRef.current) {
      if (t.content !== t.saved) await save(t.id);
    }
  }, [save]);

  const closeTab = useCallback(
    async (id: string) => {
      const tab = tabsRef.current.find((t) => t.id === id);
      if (tab && tab.content !== tab.saved) {
        if (!confirm(`${tab.path} has unsaved changes. Close anyway?`)) return;
      }
      const timer = saveTimers.current.get(id);
      if (timer) {
        clearTimeout(timer);
        saveTimers.current.delete(id);
      }
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        setActiveId((cur) => (cur === id ? next[next.length - 1]?.id ?? null : cur));
        return next;
      });
    },
    []
  );

  const onChange = useCallback(
    (v: string) => {
      const id = activeId;
      if (!id) return;
      setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, content: v } : t)));
      const existing = saveTimers.current.get(id);
      if (existing) clearTimeout(existing);
      saveTimers.current.set(
        id,
        setTimeout(() => {
          saveTimers.current.delete(id);
          save(id);
        }, 1200)
      );
    },
    [activeId, save]
  );

  useEffect(() => {
    const timers = saveTimers.current;
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  // 에이전트가 Big Brother 쪽에서 파일을 고치므로, 여기서 다시 읽어온다.
  const onFilesChanged = useCallback(async () => {
    const next = await refreshFiles();
    for (const tab of tabsRef.current) {
      const still = next.find((f) => f.id === tab.id);
      if (!still) {
        setTabs((prev) => prev.filter((t) => t.id !== tab.id));
        setActiveId((cur) => (cur === tab.id ? null : cur));
        continue;
      }
      const res = await readSpaceFile(tab.id);
      if ("error" in res) continue;
      // 편집 중이던 내용을 말없이 덮어쓰지 않는다 — 저장된 것과 같을 때만 갱신.
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tab.id && t.content === t.saved
            ? { ...t, content: res.content, saved: res.content, path: still.path || still.name }
            : t.id === tab.id
            ? { ...t, saved: res.content }
            : t
        )
      );
      if (tab.id === activeId && tab.content === tab.saved) apiRef.current?.applyContent(res.content);
    }
    router.refresh();
  }, [refreshFiles, router, activeId]);

  // ---- 단축키 ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (e.shiftKey) saveAll();
        else if (activeId) save(activeId);
      } else if (mod && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setQuickOpen(true);
      } else if (mod && e.key.toLowerCase() === "w" && activeId) {
        e.preventDefault();
        closeTab(activeId);
      } else if (e.key === "Escape") {
        setQuickOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, save, saveAll, closeTab]);

  // ---- 파일 조작 ----
  const onUpload = useCallback(
    async (list: FileList | null) => {
      if (!list?.length) return;
      setUploading(true);
      let failed = 0;
      for (const f of Array.from(list)) {
        if (f.size > MAX_UPLOAD_BYTES) {
          failed++;
          continue;
        }
        try {
          const text = await f.text();
          const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
          const res = await addCodeFileToRepo(spaceId, rel || f.name, text);
          if ("error" in res) failed++;
        } catch {
          failed++;
        }
      }
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = "";
      if (failed) setError(`${failed} file(s) were skipped (too large or unreadable).`);
      await refreshFiles();
      router.refresh();
    },
    [spaceId, refreshFiles, router]
  );

  const onDelete = async (file: CodeRepoFile) => {
    const path = file.path || file.name;
    if (!confirm(`Move ${path} to the Trash?`)) return;
    const res = await deleteSpaceFile(file.id);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setTabs((prev) => prev.filter((t) => t.id !== file.id));
    setActiveId((cur) => (cur === file.id ? null : cur));
    await refreshFiles();
    router.refresh();
  };

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderNodes = (nodes: Node[], depth = 0): React.ReactNode =>
    nodes.map((n) =>
      n.file ? (
        <div key={n.path} className="tree-item">
          <button
            className={`tree-row file ${activeId === n.file.id ? "active" : ""}`}
            style={{ paddingLeft: 10 + depth * 12 }}
            onClick={() => openFile(n.file!)}
            title={n.path}
          >
            {n.name}
            {tabs.some((t) => t.id === n.file!.id && t.content !== t.saved) && (
              <span className="tree-dirty">●</span>
            )}
          </button>
          <span className="tree-actions">
            <button title="Rename" onClick={() => setDialog({ kind: "rename", file: n.file! })}>
              ✎
            </button>
            <button title="Delete" onClick={() => onDelete(n.file!)}>
              ✕
            </button>
          </span>
        </div>
      ) : (
        <div key={n.path}>
          <div className="tree-item">
            <button
              className="tree-row dir"
              style={{ paddingLeft: 10 + depth * 12 }}
              onClick={() => toggle(n.path)}
            >
              <span className="tree-caret">{collapsed.has(n.path) ? "▸" : "▾"}</span>
              {n.name}
            </button>
            <span className="tree-actions">
              <button title="New file here" onClick={() => setDialog({ kind: "new", prefix: n.path })}>
                +
              </button>
              <button title="Rename folder" onClick={() => setDialog({ kind: "renameFolder", path: n.path })}>
                ✎
              </button>
            </span>
          </div>
          {!collapsed.has(n.path) && renderNodes(n.children, depth + 1)}
        </div>
      )
    );

  return (
    <div className="space-shell">
      <div className="space-bar">
        <button className="btn btn-sm" onClick={() => router.push("/code")}>
          ‹ Code
        </button>
        <h1 className="space-title">{spaceName}</h1>
        {github.owner && (
          <a
            className="space-origin"
            href={`https://github.com/${github.owner}/${github.repo}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {github.owner}/{github.repo} ↗
          </a>
        )}
        <div className="row" style={{ gap: 6, marginLeft: "auto" }}>
          <span className="mono muted" style={{ fontSize: 11 }}>
            {files.length} files{dirtyCount > 0 && ` · ${dirtyCount} unsaved`}
          </span>
          <button className="btn btn-sm" onClick={() => setQuickOpen(true)} title="Cmd/Ctrl+P">
            Go to file
          </button>
          <button className="btn btn-sm" onClick={() => setDialog({ kind: "new" })}>
            New file
          </button>
          <button className="btn btn-sm" onClick={() => uploadRef.current?.click()} disabled={uploading}>
            {uploading ? "Adding…" : "Add files"}
          </button>
          <button className="btn btn-sm" onClick={onFilesChanged} title="Reload files changed by the agent">
            Refresh
          </button>
          {dirtyCount > 0 && (
            <button className="btn btn-sm btn-primary" onClick={saveAll} title="Cmd/Ctrl+Shift+S">
              Save all
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setDialog({ kind: "github" })}>
            Push to GitHub
          </button>
          <button className="btn btn-sm" onClick={() => setDialog({ kind: "deploy" })}>
            Deploy
          </button>
        </div>
      </div>
      <input ref={uploadRef} type="file" multiple hidden onChange={(e) => onUpload(e.target.files)} />

      {error && (
        <div className="notice notice-error" style={{ margin: 0 }}>
          {error}
          <button className="btn btn-sm" style={{ marginLeft: 10 }} onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="space-body">
        <aside className="space-tree hscroll">
          {files.length === 0 ? (
            <p className="tree-empty">
              Empty Code Space. Add a file here, or build it with the agent in Big Brother →
              Vibe coding.
            </p>
          ) : (
            renderNodes(tree)
          )}
        </aside>

        <div className="space-main">
          {tabs.length > 0 && (
            <div className="tab-strip hscroll">
              {tabs.map((t) => (
                <div
                  key={t.id}
                  className={`tab ${t.id === activeId ? "active" : ""}`}
                  onClick={() => {
                    setActiveId(t.id);
                    setShowDiff(false);
                  }}
                >
                  <span className="tab-name">{t.path.split("/").pop()}</span>
                  {t.content !== t.saved && <span className="tab-dot">●</span>}
                  <button
                    className="tab-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(t.id);
                    }}
                    aria-label={`Close ${t.path}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="space-editor">
            {active ? (
              <>
                <div className="editor-tab">
                  <span className="mono breadcrumb">{active.path.split("/").join(" › ")}</span>
                  <div className="row" style={{ gap: 8 }}>
                    {active.content !== active.saved && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setShowDiff((v) => !v)}
                        title="Compare with the saved version"
                      >
                        {showDiff ? "Edit" : "Review changes"}
                      </button>
                    )}
                    <span className={`save-state ${active.content !== active.saved ? "dirty" : "saved"}`}>
                      {active.content !== active.saved ? "UNSAVED" : "SAVED"}
                    </span>
                  </div>
                </div>
                {loading ? (
                  <div className="empty">Loading…</div>
                ) : showDiff ? (
                  <MonacoDiff
                    original={active.saved}
                    modified={active.content}
                    language={active.language}
                  />
                ) : (
                  <MonacoCodeEditor
                    key={active.id}
                    value={active.content}
                    language={active.language}
                    editable
                    onChange={onChange}
                    onReady={(api) => (apiRef.current = api)}
                  />
                )}
              </>
            ) : (
              <div className="empty">
                <div style={{ textAlign: "center", lineHeight: 1.8 }}>
                  Select a file, or press <kbd>Cmd/Ctrl</kbd> + <kbd>P</kbd> to jump to one.
                  <br />
                  <span className="muted" style={{ fontSize: 12 }}>
                    Cmd+S save · Cmd+Shift+S save all · Cmd+W close tab · Cmd+F find · F1 command
                    palette
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {quickOpen && (
        <QuickOpen
          files={files}
          onClose={() => setQuickOpen(false)}
          onPick={(f) => {
            setQuickOpen(false);
            openFile(f);
          }}
        />
      )}

      {dialog?.kind === "new" && (
        <PathDialog
          title="New file"
          initial={dialog.prefix ? `${dialog.prefix}/` : ""}
          placeholder="src/index.ts"
          hint="Use slashes to put the file in a folder — folders are created as needed."
          confirmLabel="Create"
          onClose={() => setDialog(null)}
          onSubmit={async (path) => {
            const res = await createSpaceFile(spaceId, path);
            if ("error" in res) return res.error;
            setDialog(null);
            const next = await refreshFiles();
            const hit = next.find((f) => f.id === res.id);
            if (hit) openFile(hit);
            return null;
          }}
        />
      )}
      {dialog?.kind === "rename" && (
        <PathDialog
          title="Rename file"
          initial={dialog.file.path || dialog.file.name}
          placeholder="src/index.ts"
          hint="Changing the folder part moves the file."
          confirmLabel="Rename"
          onClose={() => setDialog(null)}
          onSubmit={async (path) => {
            const res = await renameSpaceFile(dialog.file.id, path);
            if ("error" in res) return res.error;
            setDialog(null);
            setTabs((prev) =>
              prev.map((t) => (t.id === dialog.file.id ? { ...t, path: res.path } : t))
            );
            await refreshFiles();
            return null;
          }}
        />
      )}
      {dialog?.kind === "renameFolder" && (
        <PathDialog
          title="Rename folder"
          initial={dialog.path}
          placeholder="src/components"
          hint="Every file under this folder moves with it."
          confirmLabel="Rename"
          onClose={() => setDialog(null)}
          onSubmit={async (path) => {
            const res = await renameSpaceFolder(spaceId, dialog.path, path);
            if ("error" in res) return res.error;
            setDialog(null);
            const next = await refreshFiles();
            setTabs((prev) =>
              prev.map((t) => {
                const f = next.find((n) => n.id === t.id);
                return f ? { ...t, path: f.path || f.name } : t;
              })
            );
            return null;
          }}
        />
      )}
      {dialog?.kind === "github" && (
        <GithubPushDialog
          spaceId={spaceId}
          spaceName={spaceName}
          github={github}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "deploy" && (
        <VercelDeployDialog spaceId={spaceId} spaceName={spaceName} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

/** Cmd+P — 경로를 흐릿하게 쳐도 찾아준다. */
function QuickOpen({
  files,
  onClose,
  onPick,
}: {
  files: CodeRepoFile[];
  onClose: () => void;
  onPick: (f: CodeRepoFile) => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const matches = useMemo(
    () => files.filter((f) => fuzzyMatch(f.path || f.name, query)).slice(0, 50),
    [files, query]
  );

  useEffect(() => setIndex(0), [query]);

  return (
    <div className="quick-open-backdrop" onClick={onClose}>
      <div className="quick-open" onClick={(e) => e.stopPropagation()}>
        <input
          className="quick-open-input mono"
          placeholder="Go to file…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && matches[index]) {
              e.preventDefault();
              onPick(matches[index]);
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
        />
        <div className="quick-open-list">
          {matches.length === 0 ? (
            <div className="quick-open-empty">No matching files</div>
          ) : (
            matches.map((f, i) => (
              <button
                key={f.id}
                className={`quick-open-row mono ${i === index ? "active" : ""}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => onPick(f)}
              >
                {f.path || f.name}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** 경로 하나를 받는 공용 다이얼로그(만들기 / 이름변경 / 폴더 이름변경). */
function PathDialog({
  title,
  initial,
  placeholder,
  hint,
  confirmLabel,
  onClose,
  onSubmit,
}: {
  title: string;
  initial: string;
  placeholder: string;
  hint: string;
  confirmLabel: string;
  /** 오류 문구를 돌려주면 다이얼로그를 열어둔 채 보여준다. */
  onSubmit: (path: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [path, setPath] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!path.trim() || busy) return;
    setBusy(true);
    setError(await onSubmit(path));
    setBusy(false);
  };

  return (
    <Modal title={title} onClose={onClose} width={460}>
      {error && <div className="notice notice-error">{error}</div>}
      <input
        className="input mono"
        style={{ width: "100%" }}
        placeholder={placeholder}
        value={path}
        onChange={(e) => setPath(e.target.value)}
        autoFocus
        spellCheck={false}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <p className="page-sub" style={{ marginTop: 6, fontSize: 11.5 }}>
        {hint}
      </p>
      <div className="row" style={{ gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
        <button className="btn btn-sm" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-sm btn-primary" disabled={!path.trim() || busy} onClick={submit}>
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
