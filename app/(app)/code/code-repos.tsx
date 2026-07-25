"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { IconCode, IconFiles } from "../icons";
import { OpenItemButton } from "../workspace/open-item-button";
import { planImport, parseGitHubUrl, MAX_FILES, type ImportPlan } from "@/lib/github-import";
import { startImport, useImportState, dismissImport } from "./import-store";
import {
  addCodeFileToRepo,
  createCodeRepository,
  deleteCodeRepository,
  listCodeRepoFiles,
  renameCodeRepository,
  type CodeRepoFile,
  type CodeRepository,
} from "./repo-actions";

/** 파일 확장자 기준으로 텍스트만 골라낸다(대량 업로드 시 바이너리 방지). */
const MAX_UPLOAD_BYTES = 200 * 1024;

export function CodeRepos({ repos }: { repos: CodeRepository[] }) {
  const router = useRouter();
  const [openRepo, setOpenRepo] = useState<CodeRepository | null>(null);
  const [files, setFiles] = useState<CodeRepoFile[] | null>(null);
  const [dialog, setDialog] = useState<"import" | "create" | null>(null);
  const [renameTarget, setRenameTarget] = useState<CodeRepository | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const imp = useImportState();

  // 임포트가 끝나면 목록과 열린 저장소를 갱신한다.
  useEffect(() => {
    if (imp.finishedTick === 0) return;
    router.refresh();
    if (openRepo) listCodeRepoFiles(openRepo.id).then(setFiles);
    // openRepo 를 의존성에 넣으면 저장소를 열 때마다 refresh 가 돈다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imp.finishedTick, router]);

  const enterRepo = (r: CodeRepository) => {
    setOpenRepo(r);
    setFiles(null);
    listCodeRepoFiles(r.id).then(setFiles);
  };

  const onUpload = async (list: FileList | null) => {
    if (!list?.length || !openRepo) return;
    setBusy(true);
    setError(null);
    let failed = 0;
    for (const f of Array.from(list)) {
      if (f.size > MAX_UPLOAD_BYTES) {
        failed++;
        continue;
      }
      try {
        const text = await f.text();
        // 폴더 업로드면 webkitRelativePath 에 폴더 구조가 들어 있다.
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
        const res = await addCodeFileToRepo(openRepo.id, rel || f.name, text);
        if ("error" in res) failed++;
      } catch {
        failed++;
      }
    }
    setBusy(false);
    if (failed) setError(`${failed} file(s) were skipped (too large or unreadable).`);
    if (uploadRef.current) uploadRef.current.value = "";
    listCodeRepoFiles(openRepo.id).then(setFiles);
    router.refresh();
  };

  const onDelete = async (r: CodeRepository) => {
    if (!confirm(`Move "${r.name}" and its files to the Trash?`)) return;
    const res = await deleteCodeRepository(r.id);
    if ("error" in res) setError(res.error);
    else {
      if (openRepo?.id === r.id) setOpenRepo(null);
      router.refresh();
    }
  };

  // ---- 저장소 상세 ----
  if (openRepo) {
    return (
      <>
        {error && <div className="notice notice-error">{error}</div>}
        <div className="row" style={{ gap: 8, marginBottom: 14, alignItems: "center" }}>
          <button className="btn btn-sm" onClick={() => setOpenRepo(null)}>
            ‹ All repositories
          </button>
          <h2 className="h-title" style={{ margin: 0 }}>{openRepo.name}</h2>
          {openRepo.github_owner && (
            <a
              className="page-sub"
              style={{ margin: 0 }}
              href={`https://github.com/${openRepo.github_owner}/${openRepo.github_repo}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {openRepo.github_owner}/{openRepo.github_repo}
              {openRepo.github_ref ? `@${openRepo.github_ref}` : ""} ↗
            </a>
          )}
          <div className="row" style={{ gap: 6, marginLeft: "auto" }}>
            <button
              className="btn btn-sm"
              onClick={() => uploadRef.current?.click()}
              disabled={busy}
            >
              {busy ? "Adding…" : "Add files"}
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

        {files === null ? (
          <div className="empty">Loading…</div>
        ) : files.length === 0 ? (
          <div className="empty">No files yet — use “Add files” to upload some.</div>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}></th>
                  <th>Path</th>
                  <th style={{ width: 110 }} className="col-hide-mobile">Language</th>
                  <th style={{ width: 90 }}></th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <span className="drive-icon"><IconCode size={15} /></span>
                    </td>
                    <td>
                      <OpenItemButton kind="code" id={f.id} title={f.name} className="link-btn">
                        {f.path || f.name}
                      </OpenItemButton>
                    </td>
                    <td className="muted col-hide-mobile">{f.language}</td>
                    <td>
                      <OpenItemButton kind="code" id={f.id} title={f.name} className="btn btn-ghost btn-sm">
                        Open
                      </OpenItemButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }

  // ---- 저장소 목록 ----
  return (
    <>
      {error && <div className="notice notice-error">{error}</div>}
      <ImportProgress />

      <div className="row" style={{ gap: 8, marginBottom: 14 }}>
        <button className="btn btn-sm btn-primary" onClick={() => setDialog("import")}>
          Import from GitHub
        </button>
        <button className="btn btn-sm" onClick={() => setDialog("create")}>
          New code repository
        </button>
      </div>

      {repos.length === 0 ? (
        <div className="empty">
          No code repositories yet. Import one from GitHub, or create an empty one.
        </div>
      ) : (
        <div className="table-scroll" style={{ marginBottom: 22 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 46 }}></th>
                <th>Repository</th>
                <th style={{ width: 90 }}>Files</th>
                <th style={{ width: 200 }} className="col-hide-mobile">Source</th>
                <th style={{ width: 150 }}></th>
              </tr>
            </thead>
            <tbody>
              {repos.map((r) => (
                <tr key={r.id} className="drive-row clickable">
                  <td onClick={() => enterRepo(r)}>
                    <span className="drive-icon folder"><IconFiles size={16} /></span>
                  </td>
                  <td onClick={() => enterRepo(r)}>{r.name}</td>
                  <td className="mono muted">{r.file_count}</td>
                  <td className="muted col-hide-mobile" style={{ fontSize: 12 }}>
                    {r.github_owner ? `${r.github_owner}/${r.github_repo}` : "—"}
                  </td>
                  <td>
                    <div className="row row-actions" style={{ gap: 4 }}>
                      <button className="btn btn-sm" onClick={() => setRenameTarget(r)}>
                        Rename
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => onDelete(r)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog === "import" && (
        <ImportDialog onClose={() => setDialog(null)} onDone={() => { setDialog(null); router.refresh(); }} />
      )}
      {dialog === "create" && (
        <CreateDialog onClose={() => setDialog(null)} onDone={() => { setDialog(null); router.refresh(); }} />
      )}
      {renameTarget && (
        <RenameDialog
          repo={renameTarget}
          onClose={() => setRenameTarget(null)}
          onDone={() => { setRenameTarget(null); router.refresh(); }}
        />
      )}
    </>
  );
}

function ImportProgress() {
  const imp = useImportState();
  if (!imp.repoLabel) return null;
  const pct = imp.total > 0 ? Math.round(((imp.done + imp.failed) / imp.total) * 100) : 0;
  return (
    <div className="panel" style={{ padding: "12px 14px", marginBottom: 14 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <span className="label">
          {imp.active ? `IMPORTING ${imp.repoLabel} · ${pct}%` : `IMPORTED ${imp.repoLabel}`}
        </span>
        <span className="mono muted" style={{ fontSize: 11 }}>
          {imp.done + imp.failed} / {imp.total}
          {imp.failed > 0 ? ` · ${imp.failed} failed` : ""}
        </span>
      </div>
      <div className="upload-bar">
        <div className="upload-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      {!imp.active && (
        <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={dismissImport}>
          Dismiss
        </button>
      )}
    </div>
  );
}

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const scan = async () => {
    setBusy(true);
    setError(null);
    try {
      setPlan(await planImport(url, token || undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that repository.");
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!plan) return;
    setBusy(true);
    const res = await createCodeRepository(`${plan.ref.owner}/${plan.ref.repo}`, plan.ref);
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    startImport({ repoId: res.id, ref: plan.ref, files: plan.files, token: token || undefined });
    onDone();
  };

  return (
    <Modal title="Import from GitHub" onClose={onClose} width={520}>
      {error && <div className="notice notice-error">{error}</div>}

      <div className="label" style={{ marginBottom: 6 }}>REPOSITORY URL</div>
      <input
        className="input"
        style={{ width: "100%" }}
        placeholder="https://github.com/owner/repo"
        value={url}
        onChange={(e) => { setUrl(e.target.value); setPlan(null); }}
        autoFocus
      />

      <div className="label" style={{ margin: "14px 0 6px" }}>
        ACCESS TOKEN (optional — required for private repos)
      </div>
      <input
        className="input"
        style={{ width: "100%" }}
        type="password"
        placeholder="ghp_…"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        autoComplete="off"
      />
      <p className="page-sub" style={{ marginTop: 6, fontSize: 11.5 }}>
        Without a token GitHub allows 60 requests/hour. Only one is used to read the
        file list — file contents come from a CDN with no such limit.
      </p>

      {plan && (
        <div className="notice notice-info" style={{ marginTop: 14 }}>
          <strong>{plan.ref.owner}/{plan.ref.repo}</strong> @ {plan.ref.ref} —{" "}
          {plan.files.length} text file(s) will be imported
          {plan.skipped > 0 && `, ${plan.skipped} skipped (binaries, build output, or too large)`}.
          {plan.truncated && (
            <>
              <br />
              Only the first {MAX_FILES} files are imported — this repository is larger.
            </>
          )}
        </div>
      )}

      <div className="row" style={{ gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
        <button className="btn btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
        {plan ? (
          <button className="btn btn-sm btn-primary" onClick={run} disabled={busy}>
            {busy ? "Starting…" : `Import ${plan.files.length} files`}
          </button>
        ) : (
          <button
            className="btn btn-sm btn-primary"
            onClick={scan}
            disabled={busy || !parseGitHubUrl(url)}
          >
            {busy ? "Scanning…" : "Scan repository"}
          </button>
        )}
      </div>
    </Modal>
  );
}

function CreateDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="New code repository" onClose={onClose} width={420}>
      {error && <div className="notice notice-error">{error}</div>}
      <input
        className="input"
        style={{ width: "100%" }}
        placeholder="Repository name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <div className="row" style={{ gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
        <button className="btn btn-sm" onClick={onClose}>Cancel</button>
        <button
          className="btn btn-sm btn-primary"
          disabled={!name.trim()}
          onClick={async () => {
            const res = await createCodeRepository(name);
            if ("error" in res) setError(res.error);
            else onDone();
          }}
        >
          Create
        </button>
      </div>
    </Modal>
  );
}

function RenameDialog({
  repo,
  onClose,
  onDone,
}: {
  repo: CodeRepository;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(repo.name);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Rename repository" onClose={onClose} width={420}>
      {error && <div className="notice notice-error">{error}</div>}
      <input
        className="input"
        style={{ width: "100%" }}
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <div className="row" style={{ gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
        <button className="btn btn-sm" onClick={onClose}>Cancel</button>
        <button
          className="btn btn-sm btn-primary"
          disabled={!name.trim()}
          onClick={async () => {
            const res = await renameCodeRepository(repo.id, name);
            if ("error" in res) setError(res.error);
            else onDone();
          }}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}
