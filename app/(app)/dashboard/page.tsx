import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { Copyable } from "@/components/copyable";
import { StorageBreakdownChart, StorageShareBar } from "./storage-chart";
import { OpenItemButton } from "../workspace/open-item-button";

export default async function DashboardPage() {
  const { userId, profile } = await requireUser();
  const supabase = await createClient();

  const [
    filesRes,
    docsRes,
    codeRes,
    sheetsRes,
    mapsRes,
    sharedDocsRes,
    myUsageRes,
    platformUsageRes,
  ] = await Promise.all([
    supabase.from("files").select("id", { count: "exact", head: true }),
    supabase.from("documents").select("id", { count: "exact", head: true }),
    supabase.from("code_files").select("id", { count: "exact", head: true }),
    supabase.from("sheets").select("id", { count: "exact", head: true }),
    supabase.from("mind_maps").select("id", { count: "exact", head: true }),
    supabase
      .from("documents")
      .select("id, title, updated_at, owner_id")
      .order("updated_at", { ascending: false })
      .limit(5),
    supabase.rpc("my_content_breakdown"),
    supabase.rpc("platform_content_breakdown"),
  ]);

  const fileCount = filesRes.count ?? 0;
  const docCount = docsRes.count ?? 0;
  const codeCount = codeRes.count ?? 0;
  const sheetCount = sheetsRes.count ?? 0;
  const mapCount = mapsRes.count ?? 0;
  const recentDocs = sharedDocsRes.data ?? [];

  const myUsage = myUsageRes.data ?? [];
  const platformUsage = platformUsageRes.data ?? [];
  const myBytes = myUsage.reduce((s, r) => s + r.bytes, 0);
  const platformBytes = platformUsage.reduce((s, r) => s + r.bytes, 0);

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">Operational View</span>
        <span className="crumb">HOME / OPERATIONAL VIEW</span>
      </div>

      <div className="content">
        <div className="page-head">
          <div>
            <h1 className="page-h">
              Welcome, {profile.display_name || profile.email.split("@")[0]}
            </h1>
          </div>
        </div>

        <div className="stat-grid">
          <div className="stat">
            <div className="stat-val">{docCount}</div>
            <div className="stat-label label">DOCS +</div>
          </div>
          <div className="stat">
            <div className="stat-val">{codeCount}</div>
            <div className="stat-label label">CODE FILES</div>
          </div>
          <div className="stat">
            <div className="stat-val">{fileCount}</div>
            <div className="stat-label label">REPOSITORY</div>
          </div>
          <div className="stat">
            <div className="stat-val">{sheetCount}</div>
            <div className="stat-label label">TABLE</div>
          </div>
          <div className="stat">
            <div className="stat-val">{mapCount}</div>
            <div className="stat-label label">LINK GRAPH</div>
          </div>
          <div className="stat">
            <div className="stat-val">{profile.role === "admin" ? "ADMIN" : "USER"}</div>
            <div className="stat-label label">ACCESS LEVEL</div>
          </div>
        </div>

        <div className="stg-grid">
          <div className="panel">
            <div className="panel-header">
              <span className="label">MY STORAGE USAGE</span>
            </div>
            <div className="panel-body">
              <StorageBreakdownChart rows={myUsage} />
            </div>
          </div>
          <div className="panel">
            <div className="panel-header">
              <span className="label">SHARE OF PLATFORM TOTAL</span>
            </div>
            <div className="panel-body">
              <StorageShareBar myBytes={myBytes} platformBytes={platformBytes} />
            </div>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-header">
            <span className="label">My Share ID</span>
          </div>
          <div className="panel-body">
            <p className="page-sub" style={{ margin: "0 0 12px" }}>
              To let someone share a file, document, sheet or map with you, give
              them this ID — they paste it into the <strong>Share</strong> dialog
              on their item. To share <em>your</em> items, open any list (Docs,
              Code, Repository, Table, Link Graph) and use the{" "}
              <strong>Share</strong> button on the row (or the Share button inside
              the editor), then enter the recipient&rsquo;s Share ID.
            </p>
            <Copyable value={userId} />
          </div>
        </div>

        {profile.role === "admin" && (
          <Link href="/admin/users" className="panel admin-cta" style={{ marginBottom: 24 }}>
            <div className="panel-body admin-cta-body">
              <div>
                <span className="label">ADMIN</span>
                <div className="admin-cta-title">Manage all Mobil users</div>
                <p className="page-sub" style={{ margin: "6px 0 0" }}>
                  View every account&rsquo;s role, storage usage and content counts.
                </p>
              </div>
              <span className="btn btn-primary btn-sm">Open</span>
            </div>
          </Link>
        )}

        <div className="panel">
          <div className="panel-header">
            <span className="label">RECENT DOCS +</span>
            <Link href="/documents" className="btn btn-ghost btn-sm">
              View all
            </Link>
          </div>
          {recentDocs.length === 0 ? (
            <div className="empty">
              No docs yet.{" "}
              <Link href="/documents">Create your first document.</Link>
            </div>
          ) : (
            <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th style={{ width: 180 }} className="col-hide-mobile">Updated</th>
                  <th style={{ width: 90 }}></th>
                </tr>
              </thead>
              <tbody>
                {recentDocs.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <OpenItemButton
                        kind="document"
                        id={d.id}
                        title={d.title || "Untitled"}
                        className="link-btn"
                      >
                        {d.title || "Untitled"}
                      </OpenItemButton>
                    </td>
                    <td className="mono muted col-hide-mobile">
                      {new Date(d.updated_at).toLocaleString("en-US")}
                    </td>
                    <td>
                      <OpenItemButton
                        kind="document"
                        id={d.id}
                        title={d.title || "Untitled"}
                        className="btn btn-ghost btn-sm"
                      >
                        Open
                      </OpenItemButton>
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

export const dynamic = "force-dynamic";
