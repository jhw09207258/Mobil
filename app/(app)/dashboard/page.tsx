import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { Copyable } from "@/components/copyable";
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

  // 아홉 개 조회를 **한 묶음**으로 띄운다. 예전엔 "다음 일정"만 아래에서
  // 따로 await 했는데, 앞의 묶음이 전부 끝나야 시작하므로 DB 왕복이 한 번 더
  // 직렬로 붙었다 — 이 앱에서 그 왕복 한 번은 30ms 안팎이고(계측된
  // calendar.upcoming 중앙값 36.6ms 는 테이블에 행이 5개뿐인 상태의 값이라
  // 사실상 전부 네트워크 시간이다), 대시보드가 열릴 때마다 그만큼 늦어졌다.
  // 서로 의존하지 않는 조회이므로 같이 보내면 그 30ms 가 통째로 사라진다.
  const [
    filesRes,
    docsRes,
    codeRes,
    sheetsRes,
    mapsRes,
    myUsageRes,
    platformUsageRes,
    weeklyRes,
    upcomingRes,
  ] = await Promise.all([
    supabase.from("files").select("id", { count: "exact", head: true }),
    supabase.from("documents").select("id", { count: "exact", head: true }),
    supabase.from("code_files").select("id", { count: "exact", head: true }),
    supabase.from("sheets").select("id", { count: "exact", head: true }),
    supabase.from("mind_maps").select("id", { count: "exact", head: true }),
    supabase.rpc("my_content_breakdown"),
    supabase.rpc("platform_content_breakdown"),
    supabase.rpc("my_weekly_activity"),
    // 다음 일정 — 반복 규칙은 그대로 내려보내고 전개는 화면에서 한다.
    measure(supabase, "calendar.upcoming", async () =>
      supabase.rpc("list_upcoming_events", { p_days: 7 })
    ),
  ]);
  const upcoming = upcomingRes.data;

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
            </div>
            <NetMonitor />
          </div>
        </div>

        <div className="dash-sidebar">
          <UpcomingStrip rows={upcoming ?? []} variant="list" />

          <div className="dash-card">
            <span className="label cell-label">STORAGE</span>
            <StorageBreakdownChart rows={myUsage} />
            <div className="stg-share-inline">
              <StorageShareBar myBytes={myBytes} platformBytes={platformBytes} />
            </div>
            <div className="stg-shareid-inline">
              <span className="label cell-label">MY SHARE ID</span>
              <Copyable value={userId} secret />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";
