"use client";

// ============================================================================
// 사용자 테마 — 선택한 색상 하나에서 전체 팔레트(배경 틴트·액센트·링크·
// 포커스·선택 영역)를 파생한다. 텍스트 색은 건드리지 않고(중립 그레이 유지),
// 액센트는 명도/채도를 가독성 범위로 클램프해 어떤 색을 골라도 버튼·글씨의
// 시인성이 유지되게 한다. CSS 변수만 덮어쓰므로 모달·채팅·에디터·대시보드
// 전부가 자동으로 같은 테마를 따른다.
// localStorage 에 "계산된 변수"까지 저장한다 — 루트 레이아웃의 인라인
// 스크립트가 첫 페인트 전에 그대로 적용해 깜빡임(FOUC)을 막는다.
// ============================================================================

export const THEME_KEY = "mobil.theme.v1";

export type StoredTheme = { accent: string; vars: Record<string, string> };

const THEME_VAR_KEYS = [
  "--create",
  "--create-hover",
  "--create-dim",
  "--create-ghost",
  "--on-create",
  "--steel",
  "--steel-hover",
  "--selection-bg",
  "--bg-0",
  "--bg-1",
  "--bg-2",
  "--bg-3",
  "--bg-4",
  "--border-0",
  "--border-1",
  "--border-2",
] as const;

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s: s * 100, l: l * 100 };
}

const hsl = (h: number, s: number, l: number) =>
  `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l * 10) / 10}%)`;
const hsla = (h: number, s: number, l: number, a: number) =>
  `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}% / ${a})`;

/** 선택 색상 → 전체 CSS 변수 세트. 유효하지 않은 색이면 null. */
export function computeThemeVars(accent: string): Record<string, string> | null {
  const p = hexToHsl(accent);
  if (!p) return null;
  const h = p.h;
  // 가독성 클램프: 너무 옅거나 쨍한 색은 버튼 배경으로 못 쓴다.
  const s = Math.min(85, Math.max(40, p.s));
  const l = Math.min(58, Math.max(36, p.l));
  // 액센트 명도에 따라 버튼 글자색을 흑/백으로 — 대비 유지.
  const onCreate = l > 50 ? "#0b120c" : "#f2fbf2";

  return {
    "--create": hsl(h, s, l),
    "--create-hover": hsl(h, s, Math.min(66, l + 7)),
    "--create-dim": hsl(h, s, Math.max(22, l - 14)),
    "--create-ghost": hsla(h, s, l, 0.14),
    "--on-create": onCreate,
    "--steel": hsl(h, 38, 56),
    "--steel-hover": hsl(h, 40, 64),
    "--selection-bg": hsla(h, 45, 55, 0.45),
    // 배경/경계선: 같은 색상(hue)의 저채도 틴트 — 텍스트 대비는 그대로.
    "--bg-0": hsl(h, 12, 3),
    "--bg-1": hsl(h, 11, 5.5),
    "--bg-2": hsl(h, 10, 9),
    "--bg-3": hsl(h, 9, 12),
    "--bg-4": hsl(h, 9, 17),
    "--border-0": hsl(h, 9, 15),
    "--border-1": hsl(h, 8, 21),
    "--border-2": hsl(h, 8, 28),
  };
}

/** 변수 적용(null 이면 기본 테마로 복원). */
export function applyThemeVars(vars: Record<string, string> | null): void {
  const root = document.documentElement;
  if (!vars) {
    for (const k of THEME_VAR_KEYS) root.style.removeProperty(k);
    return;
  }
  for (const k of THEME_VAR_KEYS) {
    if (vars[k]) root.style.setProperty(k, vars[k]);
  }
}

export function saveTheme(accent: string | null): void {
  try {
    if (!accent) {
      localStorage.removeItem(THEME_KEY);
      applyThemeVars(null);
      return;
    }
    const vars = computeThemeVars(accent);
    if (!vars) return;
    localStorage.setItem(THEME_KEY, JSON.stringify({ accent, vars } satisfies StoredTheme));
    applyThemeVars(vars);
  } catch {
    /* localStorage 접근 불가(사파리 프라이빗 등) — 세션 한정 적용만 */
  }
}

export function loadTheme(): StoredTheme | null {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredTheme;
    if (!parsed?.accent || !parsed?.vars) return null;
    return parsed;
  } catch {
    return null;
  }
}
