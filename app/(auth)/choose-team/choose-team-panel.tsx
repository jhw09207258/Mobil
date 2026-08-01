"use client";

import { useActionState, useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { createTeamAction, joinTeamAction, searchTeams, type CreateTeamState, type TeamSearchRow } from "./actions";

export function ChooseTeamPanel() {
  const [mode, setMode] = useState<"join" | "create">("join");

  return (
    <div>
      <div className="row" style={{ gap: 6, marginBottom: 18 }}>
        <button
          type="button"
          className={`category-tab ${mode === "join" ? "active" : ""}`}
          onClick={() => setMode("join")}
        >
          Join a team
        </button>
        <button
          type="button"
          className={`category-tab ${mode === "create" ? "active" : ""}`}
          onClick={() => setMode("create")}
        >
          Create a team
        </button>
      </div>
      {mode === "join" ? <JoinPanel /> : <CreatePanel />}
    </div>
  );
}

function JoinPanel() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<TeamSearchRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [justRequested, setJustRequested] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      searchTeams(query).then((r) => {
        if (!cancelled) {
          setRows(r);
          setLoading(false);
        }
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const onJoin = async (team: TeamSearchRow) => {
    setPendingId(team.id);
    setError(null);
    const res = await joinTeamAction(team.id);
    setPendingId(null);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    if (res.status === "pending") {
      setJustRequested((prev) => new Set(prev).add(team.id));
    }
    // status "joined" 는 joinTeamAction 안에서 이미 /dashboard 로 redirect 된다.
  };

  return (
    <div>
      <input
        className="input"
        placeholder="Search teams by name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginBottom: 12 }}
        autoFocus
      />
      {error && (
        <div className="notice notice-error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      {loading ? (
        <p className="dim" style={{ fontSize: 12.5 }}>
          Searching…
        </p>
      ) : !rows || rows.length === 0 ? (
        <p className="dim" style={{ fontSize: 12.5 }}>
          {query.trim() ? `No teams match "${query}".` : "No teams yet — be the first to create one."}
        </p>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {rows.map((t) => {
            const requested = t.my_status === "pending" || justRequested.has(t.id);
            const isMember = t.my_status === "active";
            return (
              <div
                key={t.id}
                className="row"
                style={{
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "10px 12px",
                  background: "var(--bg-1)",
                  border: "1px solid var(--border-1)",
                  borderRadius: "var(--radius)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span style={{ color: "var(--text-0)", fontSize: 13.5 }}>{t.name}</span>
                    <span className={`badge ${t.is_open ? "badge-ok" : ""}`}>
                      {t.is_open ? "open" : "closed"}
                    </span>
                  </div>
                  <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>
                    {t.member_count} {t.member_count === 1 ? "member" : "members"} · led by {t.leader_name}
                    {t.description ? ` · ${t.description}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={pendingId === t.id || requested || isMember}
                  onClick={() => onJoin(t)}
                  style={{ flex: "none" }}
                >
                  {isMember ? "Joined" : requested ? "Requested" : pendingId === t.id ? "…" : "Request to join"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CreatePanel() {
  const [state, formAction, pending] = useActionState<CreateTeamState, FormData>(createTeamAction, null);
  const [isOpen, setIsOpen] = useState(true);

  return (
    <form action={formAction}>
      {state && "error" in state && (
        <div className="notice notice-error" style={{ marginBottom: 12 }}>
          {state.error}
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="team-name" style={{ marginBottom: 6, display: "block" }}>
          Team name
        </label>
        <input id="team-name" name="name" className="input" placeholder="e.g. Yegrina Haute Group" required maxLength={80} />
      </div>
      <div className="field">
        <label className="label" htmlFor="team-desc" style={{ marginBottom: 6, display: "block" }}>
          Description (optional)
        </label>
        <input id="team-desc" name="description" className="input" placeholder="What this team is for" maxLength={500} />
      </div>
      <label className="row" style={{ gap: 10, marginBottom: 20, cursor: "pointer" }}>
        <Switch checked={isOpen} onCheckedChange={setIsOpen} />
        <input type="checkbox" name="is_open" checked={isOpen} readOnly hidden />
        <span>
          <span style={{ color: "var(--text-1)" }}>{isOpen ? "Open team" : "Closed team"}</span>
          <span className="page-sub" style={{ display: "block", fontSize: 11.5, marginTop: 2 }}>
            {isOpen
              ? "Anyone who finds it can join immediately."
              : "Join requests need your approval — you can change this later."}
          </span>
        </span>
      </label>
      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? "Creating…" : "Create team and continue"}
      </button>
    </form>
  );
}
