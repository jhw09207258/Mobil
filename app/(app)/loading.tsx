import { cookies } from "next/headers";
import "./reconnecting.css";
import { LAST_SEEN_COOKIE, RECONNECT_THRESHOLD_MS } from "./reconnect-shared";

/**
 * (app) 세그먼트의 Suspense fallback. 주의: Next.js 는 이 파일을 "최초
 * 진입" 뿐 아니라 이 레이아웃 아래에서 일어나는 모든 네비게이션의 로딩
 * 상태로도 재사용한다 — 그래서 아무 조건 없이 항상 보여주면 평범한 탭
 * 전환(문서→시트 등)마다 Reconnecting 이 떴다. reconnect-tracker.tsx 가
 * 남겨둔 "마지막 정상 활동 시각" 쿠키를 확인해, 최근(RECONNECT_THRESHOLD_MS
 * 이내)에도 계속 쓰고 있었다면 아무것도 그리지 않고, 오래 자리를 비웠다가
 * 돌아온 경우에만 화면을 보여준다.
 */
export default async function AppLoading() {
  const store = await cookies();
  const last = Number(store.get(LAST_SEEN_COOKIE)?.value || 0);
  const stale = !last || Date.now() - last > RECONNECT_THRESHOLD_MS;

  if (!stale) return null;

  // 투박한 텍스트 화면 대신 앱 셸 모양의 스켈레톤 — 로딩이 "화면이 곧 나올
  // 준비 과정"으로 느껴지게 한다(데스크톱 앱 첫 진입 포함).
  return (
    <div className="reconnect-screen">
      <div className="skel-shell" aria-hidden="true">
        <div className="skel-header">
          <span className="skel skel-logo" />
          <span className="skel skel-pill" style={{ marginLeft: "auto" }} />
          <span className="skel skel-avatar" />
        </div>
        <div className="skel-body">
          <div className="skel-rail">
            {Array.from({ length: 7 }).map((_, i) => (
              <span key={i} className="skel skel-railitem" />
            ))}
          </div>
          <div className="skel-main">
            <span className="skel skel-title" />
            <div className="skel-cards">
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className="skel skel-card" />
              ))}
            </div>
            <span className="skel skel-block" />
          </div>
        </div>
      </div>
      <span className="reconnect-spinner" aria-hidden="true" />
    </div>
  );
}
