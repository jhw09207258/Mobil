"use client";

import { useEffect } from "react";

/**
 * 앱 셸을 "지금 실제로 보이는 높이"에 맞춘다.
 *
 * 문제: 100dvh 는 모바일 URL 바만 반영하고 키보드는 반영하지 않는다. 그래서
 * 키보드가 올라오면 셸이 화면보다 커지고, 브라우저가 포커스된 입력을 보여주려고
 * 화면 전체를 밀어 올린다 — 헤더까지 같이 사라진다.
 *
 * visualViewport 는 키보드가 가린 만큼 줄어든 높이를 준다. 그 값을 셸 높이로
 * 쓰면 레이아웃 자체가 줄어들어, 헤더는 제자리에 있고 입력창만 키보드 바로
 * 위에 붙는다.
 *
 * 높이만 줄이면 안 된다. 브라우저는 그 시점에 이미 시각 뷰포트를 위로 밀어
 * 놓았으므로, 줄어든 셸 아래의 빈 공간이 화면에 남는다. 그래서 밀린 양
 * (offsetTop)도 함께 내보내고, CSS 는 position:fixed + top 으로 셸을 보이는
 * 영역에 정확히 얹는다.
 *
 * 이 값들은 키보드가 올라와 있을 때만 쓰인다(.keyboard-open) — 평상시 레이아웃은
 * 건드리지 않는다.
 */
export function ViewportFit() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return; // 미지원 브라우저는 기존 100dvh 폴백을 그대로 쓴다.

    const root = document.documentElement;
    let frame = 0;

    const apply = () => {
      // resize·scroll 이 연달아 오므로 프레임당 한 번만 쓴다.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.style.setProperty("--app-vh", `${Math.round(vv.height)}px`);
        root.style.setProperty("--app-vv-top", `${Math.round(vv.offsetTop)}px`);
        // 키보드가 올라와 있는 동안에만 켜지는 표식 — 좁은 화면에서 부차 요소를
        // 접어 입력 영역을 확보하는 데 쓴다.
        const keyboardUp = window.innerHeight - vv.height > 120;
        root.classList.toggle("keyboard-open", keyboardUp);
      });
    };

    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      root.style.removeProperty("--app-vh");
      root.style.removeProperty("--app-vv-top");
      root.classList.remove("keyboard-open");
    };
  }, []);

  return null;
}
