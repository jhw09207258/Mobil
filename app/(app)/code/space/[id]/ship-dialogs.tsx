"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/modal";
import {
  connectIntegration,
  deploySpaceToVercel,
  disconnectIntegration,
  getIntegrations,
  pushSpaceToGitHub,
  type IntegrationStatus,
  type Provider,
} from "./ship-actions";

// 연동 토큰은 서버에만 있다. 여기서는 연결 여부와 계정명만 받는다.
function useIntegration(provider: Provider) {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const reload = async () => {
    const all = await getIntegrations();
    setStatus(all.find((s) => s.provider === provider) ?? null);
  };
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);
  return { status, reload };
}

function ConnectRow({
  provider,
  label,
  hint,
  placeholder,
  status,
  onChanged,
}: {
  provider: Provider;
  label: string;
  hint: React.ReactNode;
  placeholder: string;
  status: IntegrationStatus | null;
  onChanged: () => void;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status?.connected) {
    return (
      <div className="notice notice-info" style={{ marginBottom: 14 }}>
        Connected to <strong>{label}</strong> as {status.account} ({status.tokenTail})
        <button
          className="btn btn-sm"
          style={{ marginLeft: 10 }}
          onClick={async () => {
            await disconnectIntegration(provider);
            onChanged();
          }}
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {error && <div className="notice notice-error">{error}</div>}
      <div className="label" style={{ marginBottom: 6 }}>
        {label.toUpperCase()} TOKEN
      </div>
      <input
        className="input mono"
        style={{ width: "100%" }}
        type="password"
        placeholder={placeholder}
        value={token}
        onChange={(e) => setToken(e.target.value)}
        autoComplete="off"
      />
      <p className="page-sub" style={{ marginTop: 6, fontSize: 11.5 }}>
        {hint}
      </p>
      <button
        className="btn btn-sm"
        style={{ marginTop: 8 }}
        disabled={!token.trim() || busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await connectIntegration(provider, token);
          setBusy(false);
          if ("error" in res) setError(res.error);
          else {
            setToken("");
            onChanged();
          }
        }}
      >
        {busy ? "Checking…" : "Connect"}
      </button>
    </div>
  );
}

export function GithubPushDialog({
  spaceId,
  spaceName,
  github,
  onClose,
}: {
  spaceId: string;
  spaceName: string;
  github: { owner: string | null; repo: string | null };
  onClose: () => void;
}) {
  const { status, reload } = useIntegration("github");
  const [repo, setRepo] = useState(github.repo || slug(spaceName));
  const [message, setMessage] = useState("Update from Possion");
  const [isPrivate, setIsPrivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ url: string; sha: string; count: number; created: boolean } | null>(
    null
  );

  return (
    <Modal title="Push to GitHub" onClose={onClose} width={520}>
      <ConnectRow
        provider="github"
        label="GitHub"
        placeholder="ghp_…"
        status={status}
        onChanged={reload}
        hint={
          <>
            Create a fine-grained or classic token with <strong>repo</strong> scope at
            github.com/settings/tokens. It is stored server-side and never sent back to the
            browser.
          </>
        }
      />

      {status?.connected && (
        <>
          {error && <div className="notice notice-error">{error}</div>}
          {done ? (
            <div className="notice notice-info">
              {done.created ? "Created" : "Updated"} <a href={done.url} target="_blank" rel="noopener noreferrer">{done.url}</a>
              <br />
              {done.count} file(s) · commit {done.sha.slice(0, 7)}
            </div>
          ) : (
            <>
              <div className="label" style={{ marginBottom: 6 }}>REPOSITORY NAME</div>
              <input
                className="input mono"
                style={{ width: "100%" }}
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="my-project"
              />
              <div className="label" style={{ margin: "14px 0 6px" }}>COMMIT MESSAGE</div>
              <input
                className="input"
                style={{ width: "100%" }}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <label className="row" style={{ gap: 8, marginTop: 12, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                />
                Create as a private repository
              </label>
              <p className="page-sub" style={{ marginTop: 10, fontSize: 11.5 }}>
                The branch is set to exactly the files in this Code Space — anything deleted
                here is removed there too.
              </p>
            </>
          )}

          <div className="row" style={{ gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
            <button className="btn btn-sm" onClick={onClose}>
              {done ? "Close" : "Cancel"}
            </button>
            {!done && (
              <button
                className="btn btn-sm btn-primary"
                disabled={!repo.trim() || busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  const res = await pushSpaceToGitHub({
                    spaceId,
                    repo,
                    message,
                    private: isPrivate,
                  });
                  setBusy(false);
                  if ("error" in res) setError(res.error);
                  else setDone({ url: res.url, sha: res.commitSha, count: res.fileCount, created: res.created });
                }}
              >
                {busy ? "Pushing…" : "Push"}
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

export function VercelDeployDialog({
  spaceId,
  spaceName,
  onClose,
}: {
  spaceId: string;
  spaceName: string;
  onClose: () => void;
}) {
  const { status, reload } = useIntegration("vercel");
  const [name, setName] = useState(slug(spaceName));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ url: string; inspector: string | null; status: string } | null>(
    null
  );

  return (
    <Modal title="Deploy to Vercel" onClose={onClose} width={520}>
      <ConnectRow
        provider="vercel"
        label="Vercel"
        placeholder="Vercel access token"
        status={status}
        onChanged={reload}
        hint={
          <>
            Create a token at vercel.com/account/tokens. It is stored server-side and never
            sent back to the browser.
          </>
        }
      />

      {status?.connected && (
        <>
          {error && <div className="notice notice-error">{error}</div>}
          {done ? (
            <div className="notice notice-info">
              Deployment {done.status} —{" "}
              <a href={done.url} target="_blank" rel="noopener noreferrer">
                {done.url}
              </a>
              {done.inspector && (
                <>
                  <br />
                  <a href={done.inspector} target="_blank" rel="noopener noreferrer">
                    Build logs ↗
                  </a>
                </>
              )}
              <br />
              Builds take a minute or two — the URL works once it finishes.
            </div>
          ) : (
            <>
              <div className="label" style={{ marginBottom: 6 }}>PROJECT NAME</div>
              <input
                className="input mono"
                style={{ width: "100%" }}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <p className="page-sub" style={{ marginTop: 6, fontSize: 11.5 }}>
                Vercel auto-detects the framework from your files. Deploying the same name
                again updates that project.
              </p>
            </>
          )}

          <div className="row" style={{ gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
            <button className="btn btn-sm" onClick={onClose}>
              {done ? "Close" : "Cancel"}
            </button>
            {!done && (
              <button
                className="btn btn-sm btn-primary"
                disabled={!name.trim() || busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  const res = await deploySpaceToVercel({ spaceId, name });
                  setBusy(false);
                  if ("error" in res) setError(res.error);
                  else setDone({ url: res.url, inspector: res.inspectorUrl, status: res.status });
                }}
              >
                {busy ? "Deploying…" : "Deploy"}
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[-._]+|[-._]+$/g, "")
      .slice(0, 90) || "code-space"
  );
}
