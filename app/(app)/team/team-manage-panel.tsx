"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { formatDate } from "@/lib/format";
import {
  approveMember,
  deleteTeam,
  leaveTeam,
  rejectMember,
  removeMember,
  setTeamOpen,
  transferLeadership,
  type TeamMemberRow,
} from "./actions";

type TeamInfo = {
  id: string;
  name: string;
  description: string | null;
  is_open: boolean;
  leader_id: string;
  created_at: string;
};

export function TeamManagePanel({
  team,
  initialMembers,
  selfId,
}: {
  team: TeamInfo;
  initialMembers: TeamMemberRow[];
  selfId: string;
}) {
  const router = useRouter();
  const [leaderId, setLeaderId] = useState(team.leader_id);
  const [isOpen, setIsOpen] = useState(team.is_open);
  const [members, setMembers] = useState(initialMembers);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLeader = leaderId === selfId;
  const pending = members.filter((m) => m.status === "pending");
  const active = members.filter((m) => m.status === "active");

  const onApprove = async (userId: string) => {
    setBusyId(userId);
    setError(null);
    const res = await approveMember(team.id, userId);
    setBusyId(null);
    if ("error" in res) return setError(res.error);
    setMembers((prev) => prev.map((m) => (m.id === userId ? { ...m, status: "active" } : m)));
  };

  const onReject = async (userId: string) => {
    setBusyId(userId);
    setError(null);
    const res = await rejectMember(team.id, userId);
    setBusyId(null);
    if ("error" in res) return setError(res.error);
    setMembers((prev) => prev.filter((m) => m.id !== userId));
  };

  const onRemove = async (member: TeamMemberRow) => {
    if (!confirm(`Remove ${member.display_name || member.email} from ${team.name}?`)) return;
    setBusyId(member.id);
    setError(null);
    const res = await removeMember(team.id, member.id);
    setBusyId(null);
    if ("error" in res) return setError(res.error);
    setMembers((prev) => prev.filter((m) => m.id !== member.id));
  };

  const onTransfer = async (member: TeamMemberRow) => {
    const name = member.display_name || member.email;
    if (!confirm(`Make ${name} the leader of ${team.name}? You'll keep your membership but lose leader controls.`)) return;
    setBusyId(member.id);
    setError(null);
    const res = await transferLeadership(team.id, member.id);
    setBusyId(null);
    if ("error" in res) return setError(res.error);
    setLeaderId(member.id);
  };

  const onToggleOpen = async (next: boolean) => {
    setIsOpen(next);
    setBusy(true);
    setError(null);
    const res = await setTeamOpen(team.id, next);
    setBusy(false);
    if ("error" in res) {
      setIsOpen(!next);
      setError(res.error);
    }
  };

  const onDelete = async () => {
    if (
      !confirm(
        `Delete "${team.name}"? Members' repositories, files, and chats are kept — only this team's grouping is removed.`
      )
    )
      return;
    setBusy(true);
    setError(null);
    const res = await deleteTeam(team.id);
    setBusy(false);
    if ("error" in res) return setError(res.error);
    router.push("/choose-team");
  };

  const onLeave = async () => {
    if (!confirm(`Leave ${team.name}?`)) return;
    setBusy(true);
    setError(null);
    const res = await leaveTeam(team.id);
    setBusy(false);
    if ("error" in res) return setError(res.error);
    router.push("/choose-team");
  };

  return (
    <div>
      {error && (
        <div className="notice notice-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      {isLeader && pending.length > 0 && (
        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-header">
            <span className="label">PENDING REQUESTS ({pending.length})</span>
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="col-hide-mobile">Email</th>
                  <th style={{ width: 180 }} />
                </tr>
              </thead>
              <tbody>
                {pending.map((m) => (
                  <tr key={m.id}>
                    <td>{m.display_name || "—"}</td>
                    <td className="mono col-hide-mobile" style={{ fontSize: 12 }}>
                      {m.email}
                    </td>
                    <td>
                      <div className="row row-actions" style={{ gap: 4 }}>
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={busyId === m.id}
                          onClick={() => onApprove(m.id)}
                        >
                          Approve
                        </button>
                        <button
                          className="btn btn-ghost btn-sm btn-danger"
                          disabled={busyId === m.id}
                          onClick={() => onReject(m.id)}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel" style={{ marginBottom: 24 }}>
        <div className="panel-header">
          <span className="label">MEMBERS ({active.length})</span>
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="col-hide-mobile">Email</th>
                <th style={{ width: 140 }} className="col-hide-mobile">Joined</th>
                {isLeader && <th style={{ width: 200 }} />}
              </tr>
            </thead>
            <tbody>
              {active.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.display_name || "—"}
                    {m.id === selfId && <span className="dim"> (you)</span>}
                    {m.is_leader && <span className="badge" style={{ marginLeft: 6 }}>leader</span>}
                  </td>
                  <td className="mono col-hide-mobile" style={{ fontSize: 12 }}>
                    {m.email}
                  </td>
                  <td className="mono muted col-hide-mobile" style={{ fontSize: 12 }}>
                    {formatDate(m.joined_at)}
                  </td>
                  {isLeader && (
                    <td>
                      {!m.is_leader && (
                        <div className="row row-actions" style={{ gap: 4 }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={busyId === m.id}
                            onClick={() => onTransfer(m)}
                          >
                            Make leader
                          </button>
                          <button
                            className="btn btn-ghost btn-sm btn-danger"
                            disabled={busyId === m.id}
                            onClick={() => onRemove(m)}
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isLeader && (
        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-header">
            <span className="label">TEAM SETTINGS</span>
          </div>
          <div className="panel-body">
            <label className="row" style={{ gap: 10, marginBottom: 18, cursor: "pointer" }}>
              <Switch checked={isOpen} onCheckedChange={onToggleOpen} disabled={busy} />
              <span>
                <span style={{ color: "var(--text-1)" }}>{isOpen ? "Open team" : "Closed team"}</span>
                <span className="page-sub" style={{ display: "block", fontSize: 11.5, marginTop: 2 }}>
                  {isOpen ? "Anyone who finds it can join immediately." : "Join requests need your approval."}
                </span>
              </span>
            </label>
            <button className="btn btn-danger btn-sm" onClick={onDelete} disabled={busy}>
              Delete team
            </button>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-body">
          {isLeader ? (
            <p className="dim" style={{ fontSize: 12.5 }}>
              As leader you can&apos;t leave this team — transfer leadership to another member or delete the team
              instead.
            </p>
          ) : (
            <button className="btn btn-ghost btn-sm btn-danger" onClick={onLeave} disabled={busy}>
              Leave team
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
