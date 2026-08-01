import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { SLO, type SloFeature } from "@/lib/slo";
import { RefreshButton } from "@/components/ui/refresh-button";

export const dynamic = "force-dynamic";

const WINDOWS = [
  { hours: 1, label: "1H" },
  { hours: 24, label: "24H" },
  { hours: 24 * 7, label: "7D" },
  { hours: 24 * 30, label: "30D" },
];

const MIN_RELIABLE_N = 30;

function fmt(ms: number | null): string {
  if (ms === null) return "—";
  return ms >= 100 ? ms.toFixed(0) : ms >= 10 ? ms.toFixed(1) : ms.toFixed(2);
}

/**
 * 관리자 전용 지연 대시보드 — v1.6.5 계측(lib/observability.ts)이 쌓은
 * `perf_samples` 를 백분위로 읽는다. 산술평균은 쓰지 않는다(v1.6.4 감사와
 * 같은 원칙) — p50/p90/p99/p999 와, 신뢰할 수 있는 표본인지(n)를 같이 보여준다.
 *
 * SLO 는 lib/slo.ts 에 있고, 전부 **잠정치**다(v1.6.4 로컬 재현 값 기준으로
 * 배포 환경 여유를 얹어 정함). 이 화면에 데이터가 쌓이는 대로 다시 보고
 * 조정해야 한다 — README 의 "SLO 목표치" 절 참고.
 */
export default async function ObservabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ hours?: string }>;
}) {
  const { profile } = await requireUser();
  if (profile.role !== "admin") {
    redirect("/admin/redeem");
  }

  const { hours: hoursParam } = await searchParams;
  const hours = WINDOWS.find((w) => String(w.hours) === hoursParam)?.hours ?? 24;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_perf_percentiles", {
    p_window_hours: hours,
  });

  const byFeature = new Map((data ?? []).map((r) => [r.feature, r]));
  const features = Object.keys(SLO) as SloFeature[];

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-h">Observability</h1>
          <p className="page-sub">
            기능별 응답시간 백분위(p50/p90/p99/p999). 산술평균은 쓰지 않는다.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <RefreshButton label="Refresh" />
          <Link href="/admin" className="btn btn-ghost btn-sm">
            ← Admin console
          </Link>
        </div>
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 16 }}>
        {WINDOWS.map((w) => (
          <Link
            key={w.hours}
            href={`/admin/observability?hours=${w.hours}`}
            className={`btn btn-sm ${w.hours === hours ? "btn-primary" : "btn-ghost"}`}
          >
            {w.label}
          </Link>
        ))}
      </div>

      {error && (
        <div className="notice notice-error" style={{ marginBottom: 16 }}>
          Failed to load percentiles. {error.message}
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <span className="label">
            SLO STATUS — LAST {WINDOWS.find((w) => w.hours === hours)?.label}
          </span>
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Feature</th>
                <th style={{ width: 70 }}>n</th>
                <th style={{ width: 70 }}>p50</th>
                <th style={{ width: 70 }} className="col-hide-mobile">
                  p90
                </th>
                <th style={{ width: 70 }}>p99</th>
                <th style={{ width: 70 }}>p999</th>
                <th style={{ width: 70 }} className="col-hide-mobile">
                  max
                </th>
                <th style={{ width: 80 }} className="col-hide-mobile">
                  outliers
                </th>
                <th style={{ width: 110 }}>status</th>
              </tr>
            </thead>
            <tbody>
              {features.map((feature) => {
                const target = SLO[feature];
                const row = byFeature.get(feature);
                const n = row?.n ?? 0;

                let status: { label: string; cls: string } = {
                  label: "no data",
                  cls: "badge",
                };
                if (n > 0 && n < MIN_RELIABLE_N) {
                  status = { label: "low n", cls: "badge" };
                } else if (n >= MIN_RELIABLE_N && row) {
                  const p99Breach = (row.p99 ?? 0) > target.p99TargetMs;
                  const p999Breach = (row.p999 ?? 0) > target.p999TargetMs;
                  if (p99Breach) status = { label: "breach", cls: "badge badge-danger" };
                  else if (p999Breach) status = { label: "tail only", cls: "badge badge-warn" };
                  else status = { label: "within SLO", cls: "badge badge-ok" };
                }

                return (
                  <tr key={feature}>
                    <td>
                      <div>{target.label}</div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        target p99 {target.p99TargetMs}ms · p999 {target.p999TargetMs}ms
                      </div>
                    </td>
                    <td className="mono muted" style={{ fontSize: 12 }}>
                      {n.toLocaleString()}
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {fmt(row?.p50 ?? null)}
                    </td>
                    <td className="mono col-hide-mobile" style={{ fontSize: 12 }}>
                      {fmt(row?.p90 ?? null)}
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {fmt(row?.p99 ?? null)}
                    </td>
                    <td className="mono" style={{ fontSize: 12, fontWeight: 600 }}>
                      {fmt(row?.p999 ?? null)}
                    </td>
                    <td className="mono muted col-hide-mobile" style={{ fontSize: 12 }}>
                      {fmt(row?.max_ms ?? null)}
                    </td>
                    <td className="mono muted col-hide-mobile" style={{ fontSize: 12 }}>
                      {row?.outlier_pct != null ? `${row.outlier_pct.toFixed(1)}%` : "—"}
                    </td>
                    <td>
                      <span className={status.cls}>{status.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 24 }}>
        <div className="panel-header">
          <span className="label">WHY THESE NUMBERS</span>
        </div>
        <div className="panel-body" style={{ fontSize: 13, lineHeight: 1.7 }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {features.map((feature) => (
              <li key={feature} style={{ marginBottom: 6 }}>
                <b>{SLO[feature].label}</b> — {SLO[feature].note}
              </li>
            ))}
          </ul>
          <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
            표본이 {MIN_RELIABLE_N}건 미만인 기능은 "low n" 으로 표시한다 — p999 는
            꼬리 표본이 n/1000 개뿐이라 표본이 적으면 신뢰할 수 없다. 배포 직후처럼
            트래픽이 적을 때는 대부분 "no data"/"low n" 인 것이 정상이다.
          </p>
        </div>
      </div>
    </div>
  );
}
