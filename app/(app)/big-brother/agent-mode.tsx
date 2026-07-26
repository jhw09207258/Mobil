"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AgentConsole } from "./agent-console";
import {
  createCodeRepository,
  listCodeRepoFiles,
  listCodeRepositories,
  type CodeRepository,
} from "../code/repo-actions";

/**
 * Big Brother 의 Agent 모드 — Antigravity 에이전트로 Code Space 하나를
 * 통째로 만들고 고친다.
 *
 * 어느 Code Space 를 대상으로 할지 먼저 고르게 한다(없으면 여기서 새로 만든다).
 * 에이전트는 그 Space 전체를 샌드박스에 올려두고 파일을 가로질러 작업한다.
 */
export function AgentMode() {
  const router = useRouter();
  const [spaces, setSpaces] = useState<CodeRepository[] | null>(null);
  const [active, setActive] = useState<CodeRepository | null>(null);
  const [files, setFiles] = useState<{ path: string }[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCodeRepositories().then(setSpaces);
  }, []);

  const loadFiles = useCallback(async (spaceId: string) => {
    const list = await listCodeRepoFiles(spaceId);
    setFiles(list.map((f) => ({ path: f.path || f.name })));
  }, []);

  const attach = useCallback(
    async (space: CodeRepository) => {
      setActive(space);
      await loadFiles(space.id);
    },
    [loadFiles]
  );

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    const res = await createCodeRepository(name);
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    const made: CodeRepository = {
      id: res.id,
      name,
      github_owner: null,
      github_repo: null,
      github_ref: null,
      imported_at: null,
      created_at: new Date().toISOString(),
      file_count: 0,
    };
    setSpaces((prev) => (prev ? [made, ...prev] : [made]));
    setNewName("");
    attach(made);
  };

  // ---- 대상 고르기 ----
  if (!active) {
    return (
      <div className="content">
        <div className="page-head">
          <div>
            <h1 className="page-h">Agent</h1>
            <p className="page-sub">
              Pick a Code Space for the agent to work in. It sees every file in that space
              at once and can create, edit and delete across all of them.
            </p>
          </div>
        </div>

        {error && <div className="notice notice-error">{error}</div>}

        <div className="panel" style={{ padding: 16, marginBottom: 18 }}>
          <div className="label" style={{ marginBottom: 8 }}>START SOMETHING NEW</div>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 0 }}
              placeholder="Name your new Code Space"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && newName.trim() && create()}
            />
            <button
              className="btn btn-sm btn-primary"
              disabled={!newName.trim() || busy}
              onClick={create}
            >
              {busy ? "Creating…" : "Create & start"}
            </button>
          </div>
        </div>

        <div className="label" style={{ marginBottom: 8 }}>OR CONTINUE IN AN EXISTING ONE</div>
        {spaces === null ? (
          <div className="empty">Loading…</div>
        ) : spaces.length === 0 ? (
          <div className="empty">No Code Spaces yet — create one above.</div>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Code Space</th>
                  <th style={{ width: 90 }}>Files</th>
                  <th style={{ width: 200 }} className="col-hide-mobile">Source</th>
                  <th style={{ width: 110 }}></th>
                </tr>
              </thead>
              <tbody>
                {spaces.map((s) => (
                  <tr key={s.id} className="drive-row clickable">
                    <td onClick={() => attach(s)}>{s.name}</td>
                    <td className="mono muted">{s.file_count}</td>
                    <td className="muted col-hide-mobile" style={{ fontSize: 12 }}>
                      {s.github_owner ? `${s.github_owner}/${s.github_repo}` : "—"}
                    </td>
                    <td>
                      <button className="btn btn-sm btn-primary" onClick={() => attach(s)}>
                        Start
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // ---- 콘솔 ----
  return (
    <div className="agent-shell">
      <div className="agent-bar">
        <button className="btn btn-sm" onClick={() => setActive(null)}>
          ‹ Code Spaces
        </button>
        <span className="agent-title">{active.name}</span>
        <span className="mono muted" style={{ fontSize: 11 }}>
          {files.length} files
        </span>
        <div className="row" style={{ gap: 6, marginLeft: "auto" }}>
          <button
            className="btn btn-sm"
            onClick={() => router.push(`/code/space/${active.id}`)}
            title="Open the editor for this Code Space"
          >
            Open in Codespace
          </button>
        </div>
      </div>
      <AgentConsole
        spaceId={active.id}
        spaceName={active.name}
        files={files}
        onFilesChanged={() => loadFiles(active.id)}
      />
    </div>
  );
}
