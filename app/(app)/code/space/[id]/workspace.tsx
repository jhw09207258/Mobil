"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { MonacoApi } from "@/components/monaco/monaco-editor";
import { isLangKey, type LangKey } from "@/lib/languages";
import { Modal } from "@/components/modal";
import { AgentConsole } from "./agent-console";
import {
  addCodeFileToRepo,
  createSpaceFile,
  listCodeRepoFiles,
  readSpaceFile,
  writeSpaceFile,
  type CodeRepoFile,
} from "../../repo-actions";
import { GithubPushDialog, VercelDeployDialog } from "./ship-dialogs";

/** 텍스트 소스만 다루므로 큰 파일은 거른다(바이너리 방지). */
const MAX_UPLOAD_BYTES = 200 * 1024;

// Monaco 는 1MB 가 넘는다. 정적으로 import 하면 Code Space 를 열기도 전에
// 전부 받아야 하므로, 낱개 편집기와 같이 파일을 열 때만 지연 로딩한다.
const MonacoCodeEditor = dynamic(
  () => import("@/components/monaco/monaco-editor").then((m) => m.MonacoCodeEditor),
  {
    ssr: false,
    loading: () => <div className="empty">Loading editor…</div>,
  }
);

// ============================================================================
// Code Space 워크스페이스 — 파일 트리 + 에디터 + Antigravity 콘솔.
//
// 낱개 파일 편집기(/code/[id])와 달리 여기서는 Code Space 전체가 대상이다.
// 에이전트가 여러 파일을 한 번에 고치므로, 커밋이 끝나면 트리와 열린 파일을
// 다시 읽어온다.
// ============================================================================

type Node = {
  name: string;
  path: string;
  file?: CodeRepoFile;
  children: Node[];
};

function buildTree(files: CodeRepoFile[]): Node[] {
  const root: Node = { name: "", path: "", children: [] };
  for (const f of files) {
    const parts = (f.path || f.name).split("/").filter(Boolean);
    let node = root;
    parts.forEach((part, i) => {
      const isLeaf = i === parts.length - 1;
      let child = node.children.find((c) => c.name === part && !!c.file === isLeaf);
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          children: [],
          ...(isLeaf ? { file: f } : {}),
        };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = (n: Node) => {
    // 폴더 먼저, 그 다음 이름순 — 파일 탐색기의 관례.
    n.children.sort((a, b) => {
      const af = a.file ? 1 : 0;
      const bf = b.file ? 1 : 0;
      return af - bf || a.name.localeCompare(b.name);
    });
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

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
  const [openId, setOpenId] = useState<string | null>(null);
  const [openName, setOpenName] = useState("");
  const [content, setContent] = useState("");
  const [language, setLanguage] = useState<LangKey>("plaintext");
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<"new" | "github" | "deploy" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apiRef = useRef<MonacoApi | null>(null);
  const contentRef = useRef("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const tree = useMemo(() => buildTree(files), [files]);

  const refreshFiles = useCallback(async () => {
    const next = await listCodeRepoFiles(spaceId);
    setFiles(next);
    return next;
  }, [spaceId]);

  const openFile = useCallback(async (file: CodeRepoFile) => {
    setLoading(true);
    setOpenId(file.id);
    setOpenName(file.path || file.name);
    setDirty(false);
    const res = await readSpaceFile(file.id);
    setLoading(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    contentRef.current = res.content;
    setContent(res.content);
    setLanguage(isLangKey(res.language) ? res.language : "plaintext");
  }, []);

  // 에이전트가 파일을 고치면 트리를 갱신하고, 열려 있던 파일은 다시 읽는다.
  const onFilesChanged = useCallback(async () => {
    const next = await refreshFiles();
    if (openId) {
      const still = next.find((f) => f.id === openId);
      if (still) {
        const res = await readSpaceFile(openId);
        if (!("error" in res)) {
          contentRef.current = res.content;
          setContent(res.content);
          apiRef.current?.applyContent(res.content);
          setDirty(false);
        }
      } else {
        setOpenId(null);
        setContent("");
      }
    }
    router.refresh();
  }, [openId, refreshFiles, router]);

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
          // 폴더째로 올리면 webkitRelativePath 에 구조가 들어 있다.
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

  const save = useCallback(async () => {
    if (!openId) return;
    const res = await writeSpaceFile(openId, contentRef.current);
    if ("error" in res) setError(res.error);
    else setDirty(false);
  }, [openId]);

  const onChange = useCallback(
    (v: string) => {
      contentRef.current = v;
      setDirty(true);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(save, 1200);
    },
    [save]
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  // Cmd/Ctrl+S 로 즉시 저장.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

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
        <button
          key={n.path}
          className={`tree-row file ${openId === n.file.id ? "active" : ""}`}
          style={{ paddingLeft: 10 + depth * 12 }}
          onClick={() => openFile(n.file!)}
          title={n.path}
        >
          {n.name}
        </button>
      ) : (
        <div key={n.path}>
          <button
            className="tree-row dir"
            style={{ paddingLeft: 10 + depth * 12 }}
            onClick={() => toggle(n.path)}
          >
            <span className="tree-caret">{collapsed.has(n.path) ? "▸" : "▾"}</span>
            {n.name}
          </button>
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
            {files.length} files
          </span>
          <button className="btn btn-sm" onClick={() => setDialog("new")}>
            New file
          </button>
          <button className="btn btn-sm" onClick={() => uploadRef.current?.click()} disabled={uploading}>
            {uploading ? "Adding…" : "Add files"}
          </button>
          <button className="btn btn-sm" onClick={() => setDialog("github")}>
            Push to GitHub
          </button>
          <button className="btn btn-sm" onClick={() => setDialog("deploy")}>
            Deploy
          </button>
        </div>
      </div>
      <input
        ref={uploadRef}
        type="file"
        multiple
        hidden
        onChange={(e) => onUpload(e.target.files)}
      />

      {error && (
        <div className="notice notice-error" style={{ margin: "0 0 0 0" }}>
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
              Empty Code Space. Ask the agent below to build something, or add a file.
            </p>
          ) : (
            renderNodes(tree)
          )}
        </aside>

        <div className="space-main">
          <div className="space-editor">
            {openId ? (
              <>
                <div className="editor-tab">
                  <span className="mono">{openName}</span>
                  <span className={`save-state ${dirty ? "dirty" : "saved"}`}>
                    {dirty ? "UNSAVED" : "SAVED"}
                  </span>
                </div>
                {loading ? (
                  <div className="empty">Loading…</div>
                ) : (
                  <MonacoCodeEditor
                    key={openId}
                    value={content}
                    language={language}
                    editable
                    onChange={onChange}
                    onReady={(api) => (apiRef.current = api)}
                  />
                )}
              </>
            ) : (
              <div className="empty">
                Select a file, or just tell the agent what you want — it can create files itself.
              </div>
            )}
          </div>

          <AgentConsole
            spaceId={spaceId}
            spaceName={spaceName}
            files={files.map((f) => ({ path: f.path || f.name }))}
            onOpenFile={(path) => {
              const hit = files.find((f) => (f.path || f.name) === path);
              if (hit) openFile(hit);
            }}
            onFilesChanged={onFilesChanged}
            onGithub={() => setDialog("github")}
            onDeploy={() => setDialog("deploy")}
          />
        </div>
      </div>

      {dialog === "new" && (
        <NewFileDialog
          spaceId={spaceId}
          onClose={() => setDialog(null)}
          onDone={async (id) => {
            setDialog(null);
            const next = await refreshFiles();
            const hit = next.find((f) => f.id === id);
            if (hit) openFile(hit);
          }}
        />
      )}
      {dialog === "github" && (
        <GithubPushDialog spaceId={spaceId} spaceName={spaceName} github={github} onClose={() => setDialog(null)} />
      )}
      {dialog === "deploy" && (
        <VercelDeployDialog spaceId={spaceId} spaceName={spaceName} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function NewFileDialog({
  spaceId,
  onClose,
  onDone,
}: {
  spaceId: string;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="New file" onClose={onClose} width={440}>
      {error && <div className="notice notice-error">{error}</div>}
      <input
        className="input mono"
        style={{ width: "100%" }}
        placeholder="src/index.ts"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        autoFocus
        onKeyDown={(e) => e.key === "Enter" && !busy && path.trim() && submit()}
      />
      <p className="page-sub" style={{ marginTop: 6, fontSize: 11.5 }}>
        Use a path with slashes to put the file in a folder.
      </p>
      <div className="row" style={{ gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
        <button className="btn btn-sm" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-sm btn-primary" disabled={!path.trim() || busy} onClick={submit}>
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </Modal>
  );

  async function submit() {
    setBusy(true);
    const res = await createSpaceFile(spaceId, path);
    setBusy(false);
    if ("error" in res) setError(res.error);
    else onDone(res.id);
  }
}
