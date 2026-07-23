"use client";

import { useEffect } from "react";

/**
 * SaaS 콘솔 UX — 브라우저 페이지 확대/축소를 차단한다.
 * Ctrl/Cmd + 휠, Ctrl/Cmd + (+/-/0), Safari 트랙패드 핀치(gesturestart)를 막는다.
 * 모바일 더블탭/핀치는 viewport meta + touch-action 이 이미 처리한다.
 */
export function NoZoom() {
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "+" || e.key === "-" || e.key === "=" || e.key === "0") {
        e.preventDefault();
      }
    };
    const onGesture = (e: Event) => e.preventDefault();

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("gesturestart", onGesture);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("gesturestart", onGesture);
    };
  }, []);

  return null;
}
