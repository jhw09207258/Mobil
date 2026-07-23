import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { formatBytes } from "@/lib/format";
import { UserTable } from "./user-table";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const { userId, profile } = await requireUser();
  if (profile.role !== "admin") {
    redirect("/admin/redeem");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_user_overview");
  const users = data ?? [];
  const totalStorage = users.reduce((s, u) => s + u.storage_bytes, 0);
  const adminCount = users.filter((u) => u.role === "admin").length;

  return (
    <>
      <div className="content">
        <div className="page-head">
          <div>
            <h1 className="page-h">Manage Users</h1>
          </div>
        </div>

        {error && (
          <div className="notice notice-error">Failed to load users.</div>
        )}

        <div className="stat-grid">
          <div className="stat">
            <div className="stat-val">{users.length}</div>
            <div className="stat-label label">TOTAL USERS</div>
          </div>
          <div className="stat">
            <div className="stat-val">{adminCount}</div>
            <div className="stat-label label">ADMINS</div>
          </div>
          <div className="stat">
            <div className="stat-val">{formatBytes(totalStorage)}</div>
            <div className="stat-label label">TOTAL STORAGE</div>
          </div>
        </div>

        <UserTable users={users} currentUserId={userId} />
      </div>
    </>
  );
}
