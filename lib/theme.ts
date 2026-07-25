"use client";

// ============================================================================
// 앱 테마 — 라이트/다크 두 모드. <html data-theme> 속성 하나로 전환하고
// 실제 팔레트는 globals.css 의 CSS 변수(:root = 다크, [data-theme=light])가
// 담당한다. localStorage 에 모드를 저장하고, 루트 레이아웃의 인라인 스크립트가
// 첫 페인트 전에 적용해 깜빡임(FOUC)을 막는다.
// ============================================================================

export const THEME_KEY = "possion.theme.v2";
// 구버전(자유 색상 팔레트) 저장분 — 발견 시 정리한다.
const LEGACY_THEME_KEY = "mobil.theme.v1";

export type ThemeMode = "dark" | "light";

export function applyThemeMode(mode: ThemeMode): void {
  if (mode === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
}

export function saveThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_KEY, mode);
    localStorage.removeItem(LEGACY_THEME_KEY);
  } catch {
    /* localStorage 접근 불가 — 세션 한정 적용만 */
  }
  applyThemeMode(mode);
}

export function loadThemeMode(): ThemeMode {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}
