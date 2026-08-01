"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { IconFiles } from "../icons";
import { planImport, parseGitHubUrl, MAX_FILES, type ImportPlan } from "@/lib/github-import";
import { startImport, useImportState, dismissImport } from "./import-store";
import {
  createCodeRepository,
  deleteCodeRepository,
  renameCodeRepository,
  type CodeRepository,
} from "./repo-actions";

/**
 * Code Space 목록 — 기존 Repositories(문서·파일 범용 저장소)와는 별개다.
 * 하나를 열면 트리 + 에디터 + Antigravity 에이전트가 있는 워크스페이스로 간다.
 */
export function CodeRepos({ repos }: { repos: CodeRepository[] }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"import" | "create" | null>(null);
  const [renameTarget, setRenameTarget] = useState<CodeRepository | null>(null);
  const [error, setError] = useState<string | null>(null);
  const imp = useImportState();

  useEffect(() => {
    if (imp.finishedTick === 0) return;
    router.refresh();
  }, [imp.finishedTick, router]);

  const open = (r: CodeRepository) => router.push(`/code/space/${r.id}`);

  const onDelete = async (r: CodeRepository) => {
    if (!confirm(`Move "${r.name}" and its files to the Trash?`)) return;
    const res = await deleteCodeRepository(r.id);
    if ("error" in res) setError(res.error);
    else router.refresh();
  };

  return (
    <>
      {error && <div className="notice notice-error">{error}</div>}
      <ImportProgress />

      <div className="row" style={{ gap: 8, marginBottom: 14 }}>
        <button className="btn btn-sm btn-primary" onClick={() => setDialog("create")}>
          New Code Space
        </button>
        <button className="btn btn-sm" onClick={() => setDialog("import")}>
          Import from GitHub
        </button>
      </div>

      {repos.length === 0 ? (
        <div className="empty">
          No Code Spaces yet. Create an empty one and build it with the agent, or import a
          repository from GitHub.
        </div>
      ) : (
        <div className="table-scroll" style={{ marginBottom: 22 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 46 }}></th>
                <th>Code Space</th>
                <th style={{ width: 90 }}>Files</th>
                <th style={{ width: 200 }}>Source</th>
                <th style={{ width: 190 }}></th>
              </tr>
            </thead>
            <tbody>
              {repos.map((r) => (
                <tr key={r.id} className="drive-row clickable">
                  <td onClick={() => open(r)}>
                    <span className="drive-icon folder"><IconFiles size={16} /></span>
                  </td>
                  <td className="table-cell-title" onClick={() => open(r)}>{r.name}</td>
                  <td className="mono muted" data-label="Files">{r.file_count}</td>
                  <td className="muted" data-label="Source" style={{ fontSize: 12 }}>
                    {r.github_owner ? `${r.github_owner}/${r.github_repo}` : "—"}
                  </td>
                  <td>
                    <div className="row row-actions" style={{ gap: 4 }}>
                      <button className="btn btn-sm btn-primary" onClick={() => open(r)}>
                        Open
                      </button>
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
        <CreateDialog
          onClose={() => setDialog(null)}
          onDone={(id) => {
            setDialog(null);
            router.push(`/code/space/${id}`);
          }}
        />
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

function CreateDialog({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    const res = await createCodeRepository(name);
    setBusy(false);
    if ("error" in res) setError(res.error);
    else onDone(res.id);
  };

  return (
    <Modal title="New Code Space" onClose={onClose} width={440}>
      {error && <div className="notice notice-error">{error}</div>}
      <input
        className="input"
        style={{ width: "100%" }}
        placeholder="Code Space name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        onKeyDown={(e) => e.key === "Enter" && name.trim() && !busy && create()}
      />
      <p className="page-sub" style={{ marginTop: 8, fontSize: 11.5 }}>
        Starts empty. Open it and describe what you want — the agent can create the whole
        project for you.
      </p>
      <div className="row" style={{ gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
        <button className="btn btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-sm btn-primary" disabled={!name.trim() || busy} onClick={create}>
          {busy ? "Creating…" : "Create"}
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
    <Modal title="Rename Code Space" onClose={onClose} width={420}>
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
