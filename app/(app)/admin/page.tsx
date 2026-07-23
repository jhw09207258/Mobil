import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { GenerateCode } from "./generate-code";
import { MediaGc } from "./media-gc";
import { PendingApprovals } from "./pending-approvals";
import { listUsersByApproval } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminConsolePage() {
  const { profile } = await requireUser();
  if (profile.role !== "admin") {
    redirect("/admin/redeem");
  }

  const supabase = await createClient();
  const [usersRes, logsRes, pendingRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, display_name, role, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("audit_logs")
      .select("id, user_id, target_type, target_id, action, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
    listUsersByApproval("pending"),
  ]);

  const users = usersRes.data ?? [];
  const logs = logsRes.data ?? [];
  const pendingUsers = Array.isArray(pendingRes) ? pendingRes : [];

  return (
    <>
      <div className="content">
        <div className="page-head">
          <div>
            <h1 className="page-h">Admin Console</h1>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-header">
            <span className="label">PENDING APPROVALS ({pendingUsers.length})</span>
          </div>
          <div className="panel-body">
            <PendingApprovals initialUsers={pendingUsers} />
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-header">
            <span className="label">ISSUE ADMIN CODE</span>
          </div>
          <div className="panel-body">
            <GenerateCode />
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-header">
            <span className="label">MEDIA STORAGE CLEANUP</span>
          </div>
          <div className="panel-body">
            <MediaGc />
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-header">
            <span className="label">USERS ({users.length})</span>
            <Link href="/admin/users" className="btn btn-ghost btn-sm">
              Manage all users →
            </Link>
          </div>
          <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Email</th>
                <th className="col-hide-mobile">Name</th>
                <th style={{ width: 90 }}>Role</th>
                <th style={{ width: 180 }} className="col-hide-mobile">Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {u.email}
                  </td>
                  <td className="col-hide-mobile">{u.display_name || "—"}</td>
                  <td>
                    {u.role === "admin" ? (
                      <span className="badge badge-admin">admin</span>
                    ) : (
                      <span className="badge">user</span>
                    )}
                  </td>
                  <td className="mono muted col-hide-mobile" style={{ fontSize: 12 }}>
                    {formatDate(u.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <span className="label">RECENT AUDIT LOGS ({logs.length})</span>
          </div>
          {logs.length === 0 ? (
            <div className="empty">No audit logs.</div>
          ) : (
            <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Action</th>
                  <th style={{ width: 100 }} className="col-hide-mobile">Target</th>
                  <th>Target ID</th>
                  <th style={{ width: 180 }} className="col-hide-mobile">Time</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <span className="badge">{l.action}</span>
                    </td>
                    <td className="mono muted col-hide-mobile" style={{ fontSize: 12 }}>
                      {l.target_type}
                    </td>
                    <td className="mono muted" style={{ fontSize: 12 }}>
                      {l.target_id}
                    </td>
                    <td className="mono muted col-hide-mobile" style={{ fontSize: 12 }}>
                      {formatDate(l.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
