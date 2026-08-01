import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { Copyable } from "@/components/copyable";
import { GlowingBadge } from "@/components/ui/glowing-badge";
import { RefreshButton } from "@/components/ui/refresh-button";
import { StorageBreakdownChart, StorageShareBar } from "./storage-chart";
import { WeeklyActivityChart } from "./weekly-activity-chart";
import { NetMonitor } from "./net-monitor";
import { UpcomingStrip } from "./upcoming-strip";
import { measure } from "@/lib/observability";
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
    myUsageRes,
    platformUsageRes,
    weeklyRes,
  ] = await Promise.all([
    supabase.from("files").select("id", { count: "exact", head: true }),
    supabase.from("documents").select("id", { count: "exact", head: true }),
    supabase.from("code_files").select("id", { count: "exact", head: true }),
    supabase.from("sheets").select("id", { count: "exact", head: true }),
    supabase.from("mind_maps").select("id", { count: "exact", head: true }),
    supabase.rpc("my_content_breakdown"),
    supabase.rpc("platform_content_breakdown"),
    supabase.rpc("my_weekly_activity"),
  ]);

  // 다음 일정 — 반복 규칙은 그대로 내려보내고 전개는 화면에서 한다.
  const { data: upcoming } = await measure(supabase, "calendar.upcoming", async () =>
    supabase.rpc("list_upcoming_events", { p_days: 7 })
  );

  const fileCount = filesRes.count ?? 0;
  const docCount = docsRes.count ?? 0;
  const codeCount = codeRes.count ?? 0;
  const sheetCount = sheetsRes.count ?? 0;
  const mapCount = mapsRes.count ?? 0;

  const myUsage = myUsageRes.data ?? [];
  const platformUsage = platformUsageRes.data ?? [];
  const myBytes = myUsage.reduce((s, r) => s + r.bytes, 0);
  const platformBytes = platformUsage.reduce((s, r) => s + r.bytes, 0);
  const weekly = weeklyRes.data ?? [];

  const name = profile.display_name || profile.email.split("@")[0];

  return (
    <div className="content dash-content">
      <div className="page-head">
        <div>
          <h1 className="page-h">Dashboard</h1>
          <p className="page-sub">Welcome back, {name}.</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <RefreshButton />
          {profile.role === "admin" && (
            <Link href="/admin/users" className="btn btn-sm">
              Manage all Possion users →
            </Link>
          )}
        </div>
      </div>

      <div className="dash-stats-row">
        <div className="dash-stat-card">
          <div className="stat-val">{docCount}</div>
          <div className="stat-label label">DOCS +</div>
        </div>
        <div className="dash-stat-card">
          <div className="stat-val">{codeCount}</div>
          <div className="stat-label label">CODE FILES</div>
        </div>
        <div className="dash-stat-card">
          <div className="stat-val">{fileCount}</div>
          <div className="stat-label label">REPOSITORY</div>
        </div>
        <div className="dash-stat-card">
          <div className="stat-val">{sheetCount}</div>
          <div className="stat-label label">TABLE</div>
        </div>
        <div className="dash-stat-card">
          <div className="stat-val">{mapCount}</div>
          <div className="stat-label label">LINK GRAPH</div>
        </div>
        <div className="dash-stat-card">
          <div className="stat-val">{profile.role === "admin" ? "ADMIN" : "USER"}</div>
          <div className="stat-label label">ACCESS LEVEL</div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="dash-main">
          <div className="dash-card">
            <span className="label cell-label">THIS WEEK</span>
            <WeeklyActivityChart rows={weekly} />
          </div>

          <div className="dash-card dash-mega-live">
            <div className="dash-mega-live-head">
              <span className="label cell-label">LIVE DATA THROUGHPUT</span>
              <GlowingBadge variant="success">Live</GlowingBadge>
            </div>
            <NetMonitor />
          </div>
        </div>

        <div className="dash-sidebar">
          <UpcomingStrip rows={upcoming ?? []} variant="list" />

          <div className="dash-card">
            <span className="label cell-label">MY STORAGE USAGE</span>
            <StorageBreakdownChart rows={myUsage} />
          </div>

          <div className="dash-card">
            <span className="label cell-label">SHARE OF PLATFORM TOTAL</span>
            <StorageShareBar myBytes={myBytes} platformBytes={platformBytes} />
          </div>

          <div className="dash-card">
            <span className="label cell-label">MY SHARE ID</span>
            <p className="dim" style={{ fontSize: 11.5, margin: "0 0 8px" }}>
              Others paste this into their Share dialog to share items with you.
            </p>
            <Copyable value={userId} secret />
          </div>
        </div>
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";
