"use client";

import { useEffect } from "react";

/**
 * 일정 알림 발송기를 주기적으로 한 번씩 두드린다.
 *
 * 왜 필요한가: 채팅·초대 알림은 누군가 무언가를 한 순간에 보내면 되지만,
 * "10분 뒤 회의" 는 **아무도 아무것도 하지 않는 순간**에 울려야 한다. 밖에서
 * 주기적으로 불러 주는 무언가가 반드시 하나는 있어야 한다.
 *
 * 정식 경로는 Vercel Cron 이나 pg_cron 이다(README 참고). 이 컴포넌트는 그
 * 둘이 없는 환경을 위한 마지막 보루다 — 누군가 앱을 열어 두고 있는 동안에는
 * 알림이 제때 울고, 아무도 안 보고 있으면 다음에 누군가 열 때 밀린 것이
 * 나간다. 발송 요청은 멱등(claim 이 원자적)이라 여러 탭이 동시에 두드려도
 * 같은 알림이 두 번 가지 않는다.
 *
 * 화면이 가려져 있으면 쉰다 — 배경 탭이 5분마다 서버를 두드릴 이유가 없다.
 */

const INTERVAL_MS = 5 * 60 * 1000;

export function ReminderHeartbeat() {
  useEffect(() => {
    let stopped = false;

    const ping = () => {
      if (stopped || document.visibilityState !== "visible") return;
      // 실패는 조용히 넘긴다 — 설정이 안 된 서버에서는 503 이 정상 응답이다.
      fetch("/api/push/dispatch", { method: "POST", cache: "no-store" }).catch(() => {});
    };

    // 열자마자 한 번(앱을 닫아 둔 사이 밀린 알림을 흘려보낸다).
    const first = setTimeout(ping, 4000);
    const timer = setInterval(ping, INTERVAL_MS);
    document.addEventListener("visibilitychange", ping);

    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", ping);
    };
  }, []);

  return null;
}
