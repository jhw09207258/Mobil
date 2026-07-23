"use client";

import { useEffect } from "react";

/**
 * Tauri 데스크톱 앱 감지 — tauri.conf.json 의 커스텀 userAgent(MobilDesktop)
 * 로 판별해 <html data-desktop> 을 세운다. CSS 가 이 속성으로 macOS 신호등
 * 버튼 여백과 헤더 드래그 영역(-webkit-app-region)을 데스크톱에서만 적용한다
 * — 일반 브라우저(웹 SaaS)에는 아무 영향이 없다.
 */
export function DesktopChrome() {
  useEffect(() => {
    const isTauri =
      navigator.userAgent.includes("MobilDesktop") ||
      "__TAURI_INTERNALS__" in window ||
      "__TAURI__" in window;
    if (isTauri) {
      document.documentElement.dataset.desktop = "true";
    }
  }, []);
  return null;
}
