import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { Copyable } from "@/components/copyable";
import { StorageBreakdownChart, StorageShareBar } from "./storage-chart";
import { OpenItemButton } from "../workspace/open-item-button";
import { NetMonitor } from "./net-monitor";
import "./dashboard.css";

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
      .limit(8),
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
      <div className="content dash-content">
        <div className="dash-welcome">
          Welcome, <b>{profile.display_name || profile.email.split("@")[0]}</b>
          {profile.role === "admin" && (
            <>
              {" · "}
              <Link href="/admin/users">Manage all Possion users →</Link>
            </>
          )}
        </div>

        <div className="dash-mega">
          <div className="dash-mega-stats">
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

          <div className="dash-mega-grid">
            <div className="dash-mega-col">
              <div className="dash-card dash-mega-storage">
                <span className="label cell-label">MY STORAGE USAGE</span>
                <StorageBreakdownChart rows={myUsage} />
              </div>
              <div className="dash-card dash-mega-share">
                <span className="label cell-label">SHARE OF PLATFORM TOTAL</span>
                <StorageShareBar myBytes={myBytes} platformBytes={platformBytes} />
              </div>
            </div>

            <div className="dash-card dash-mega-live">
              <div className="dash-mega-live-head">
                <span className="label cell-label">LIVE DATA THROUGHPUT</span>
                <div
                  className="dash-share-id"
                  title="Others paste this ID into their Share dialog to share items with you."
                >
                  <span className="label">MY SHARE ID</span>
                  <Copyable value={userId} secret />
                </div>
              </div>
              <NetMonitor />
            </div>
          </div>
        </div>

        <div className="panel dash-recent">
          <div className="panel-header">
            <span className="label">RECENT DOCS +</span>
            <Link href="/documents" className="btn btn-ghost btn-sm">
              View all
            </Link>
          </div>
          {recentDocs.length === 0 ? (
            <div className="empty">
              No docs yet. <Link href="/documents">Create your first document.</Link>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th style={{ width: 180 }} className="col-hide-mobile">
                      Updated
                    </th>
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
