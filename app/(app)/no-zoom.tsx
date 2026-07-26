"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** 마인드맵 에디터(/mindmap/<id>)는 확대 예외 — 목록(/mindmap)은 해당 없음. */
const ZOOMABLE_ROUTE = /^\/mindmap\/[^/]+\/?$/;

/**
 * SaaS 콘솔 UX — 브라우저 페이지 확대/축소를 차단한다.
 * Ctrl/Cmd + 휠, Ctrl/Cmd + (+/-/0), Safari 트랙패드·모바일 핀치(gesturestart)를 막는다.
 *
 * 마인드맵 에디터만 예외다. mind-elixir 는 터치 핀치를 자체 구현하지 않아
 * (node_modules 확인: touchstart/gesturestart 처리 없음) 그 화면의 확대는
 * 전적으로 브라우저 확대에 기대고 있다. 여기서 gesturestart 를 막으면
 * mindmap/[id]/page.tsx 의 viewport 예외(maximumScale 5)가 Safari 에서
 * 그대로 무력화된다 — 두 곳이 짝이므로 한쪽만 고치면 안 된다.
 */
export function NoZoom() {
  const pathname = usePathname();
  const zoomAllowed = ZOOMABLE_ROUTE.test(pathname ?? "");

  useEffect(() => {
    if (zoomAllowed) return;
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
    // 라우트가 바뀌면 다시 판단해야 한다 — 마인드맵으로 들어갔는데 이전
    // 화면에서 붙인 리스너가 그대로 남아 있으면 예외가 무의미해진다.
  }, [zoomAllowed]);

  return null;
}
