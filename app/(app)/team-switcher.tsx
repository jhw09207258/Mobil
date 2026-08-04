"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { Switch } from "@/components/ui/switch";
import {
  createTeam,
  listMyTeams,
  requestJoinTeam,
  searchTeamsAction,
  setActiveTeam,
  type MyTeamRow,
  type TeamSearchRow,
} from "./team/actions";
import { IconChevronDown, IconGroup } from "./icons";

/**
 * 헤더의 팀(워크스페이스) 전환기 — 현재 팀 이름을 누르면 내가 속한 팀 목록
 * (전환), 팀 검색+가입 신청, 새 팀 만들기를 한 드롭다운에서 처리한다.
 * 계정 메뉴(header.tsx 의 .acct)와 같은 유리 드롭다운 규약을 따른다.
 */
export function TeamSwitcher({ activeTeamName }: { activeTeamName: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [myTeams, setMyTeams] = useState<MyTeamRow[] | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TeamSearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (open && myTeams === null) {
      listMyTeams().then(setMyTeams);
    }
  }, [open, myTeams]);

  useEffect(() => {
    if (!open) return;
    setSearching(true);
    const t = setTimeout(() => {
      searchTeamsAction(query).then((rows) => {
        setResults(rows);
        setSearching(false);
      });
    }, 200);
    return () => clearTimeout(t);
  }, [open, query]);

  const onSwitch = async (team: MyTeamRow) => {
    if (team.is_active_team || switching) return;
    setSwitching(team.id);
    const res = await setActiveTeam(team.id);
    setSwitching(null);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setOpen(false);
    router.refresh();
  };

  const onJoin = async (team: TeamSearchRow) => {
    setError(null);
    const res = await requestJoinTeam(team.id);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    if (res.status === "joined") {
      setOpen(false);
      setMyTeams(null);
      router.refresh();
    } else {
      setRequestedIds((prev) => new Set(prev).add(team.id));
    }
  };

  return (
    <div className="team-switcher" ref={ref}>
      <button
        type="button"
        className="team-switcher-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <IconGroup size={14} />
        <span className="team-switcher-name">{activeTeamName ?? "Choose a team"}</span>
        <IconChevronDown size={13} />
      </button>

      {open && (
        <div className="team-switcher-menu">
          {error && (
            <div className="notice notice-error" style={{ margin: "0 12px 10px", fontSize: 12 }}>
              {error}
            </div>
          )}

          <div className="team-switcher-section-label label">MY TEAMS</div>
          <div className="team-switcher-list">
            {myTeams === null ? (
              <p className="dim" style={{ fontSize: 12, padding: "0 12px" }}>
                Loading…
              </p>
            ) : (
              myTeams.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`team-switcher-item ${t.is_active_team ? "active" : ""}`}
                  onClick={() => onSwitch(t)}
                  disabled={t.status === "pending"}
                >
                  <span className="team-switcher-item-name">
                    {t.name}
                    {t.is_leader && <span className="dim" style={{ fontSize: 10 }}> · leader</span>}
                  </span>
                  {t.status === "pending" ? (
                    <span className="badge badge-warn">pending</span>
                  ) : t.is_active_team ? (
                    <span className="badge badge-ok">current</span>
                  ) : switching === t.id ? (
                    <span className="dim" style={{ fontSize: 11 }}>…</span>
                  ) : null}
                </button>
              ))
            )}
          </div>

          <div className="team-switcher-sep" />

          <div className="team-switcher-section-label label">FIND A TEAM</div>
          <input
            className="input team-switcher-search"
            placeholder="Search teams…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="team-switcher-list">
            {searching ? (
              <p className="dim" style={{ fontSize: 12, padding: "6px 12px" }}>
                Searching…
              </p>
            ) : results.length === 0 ? (
              <p className="dim" style={{ fontSize: 12, padding: "6px 12px" }}>
                {query.trim() ? "No matches." : "No other teams yet."}
              </p>
            ) : (
              results
                .filter((r) => r.my_status !== "active")
                .map((t) => {
                  const requested = t.my_status === "pending" || requestedIds.has(t.id);
                  return (
                    <div key={t.id} className="team-switcher-item">
                      <span className="team-switcher-item-name">
                        {t.name}
                        <span className="dim" style={{ fontSize: 10 }}>
                          {" "}
                          · {t.member_count} {t.member_count === 1 ? "member" : "members"} ·{" "}
                          {t.is_open ? "open" : "closed"}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={requested}
                        onClick={() => onJoin(t)}
                      >
                        {requested ? "Requested" : "Join"}
                      </button>
                    </div>
                  );
                })
            )}
          </div>

          <div className="team-switcher-sep" />
          <div style={{ padding: "8px 12px 4px" }}>
            <button
              type="button"
              className="btn btn-sm btn-block"
              onClick={() => {
                setCreateOpen(true);
                setOpen(false);
              }}
            >
              + Create a team
            </button>
            {myTeams?.find((t) => t.is_active_team) && (
              <Link
                href="/team"
                className="btn btn-ghost btn-sm btn-block"
                style={{ marginTop: 6 }}
                onClick={() => setOpen(false)}
              >
                Team settings →
              </Link>
            )}
          </div>
        </div>
      )}

      {createOpen && (
        <CreateTeamModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            setMyTeams(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function CreateTeamModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isOpen, setIsOpen] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await createTeam(name, description, isOpen);
    setPending(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    onCreated();
  };

  return (
    <Modal title="Create a team" onClose={onClose} width={420}>
      <form onSubmit={onSubmit}>
        {error && (
          <div className="notice notice-error" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}
        <div className="field">
          <label className="label" style={{ marginBottom: 6, display: "block" }}>
            Team name
          </label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            autoFocus
          />
        </div>
        <div className="field">
          <label className="label" style={{ marginBottom: 6, display: "block" }}>
            Description (optional)
          </label>
          <input
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
          />
        </div>
        <label className="row" style={{ gap: 10, marginBottom: 20, cursor: "pointer" }}>
          <Switch checked={isOpen} onCheckedChange={setIsOpen} />
          <span>
            <span style={{ color: "var(--text-1)" }}>{isOpen ? "Open team" : "Closed team"}</span>
            <span className="page-sub" style={{ display: "block", fontSize: 11.5, marginTop: 2 }}>
              {isOpen ? "Anyone who finds it can join immediately." : "Join requests need your approval."}
            </span>
          </span>
        </label>
        <button type="submit" className="btn btn-primary btn-block" disabled={pending || !name.trim()}>
          {pending ? "Creating…" : "Create team"}
        </button>
      </form>
    </Modal>
  );
}
