// ============================================================================
// 캘린더 화면이 쓰는 날짜 계산 — 전부 순수 함수.
// ----------------------------------------------------------------------------
// 표시는 보는 사람의 로컬 시간대로 한다. 종일 일정만 예외로 UTC 자정 기준이며
// (0066 참고), 그 경우 날짜 칸을 고를 때도 UTC 로 읽어야 하루가 밀리지 않는다.
// ============================================================================

export type ViewMode = "month" | "week" | "day" | "agenda";

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
}

export function addMonths(d: Date, n: number): Date {
  // 1월 31일에서 한 달을 더하면 3월 3일이 되는 굴러넘침을 막는다.
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), lastDay));
  return target;
}

export function startOfWeek(d: Date): Date {
  return addDays(startOfDay(d), -d.getDay());
}

/** 달력 격자의 시작(그 달 1일이 속한 주의 일요일). */
export function startOfMonthGrid(d: Date): Date {
  return startOfWeek(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 종일 일정이 놓일 날짜 칸. 종일은 UTC 자정으로 저장되므로 UTC 로 읽는다 —
 * 로컬로 읽으면 UTC-n 시간대에서 하루 앞으로 밀린다.
 */
export function allDayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** 화면에 보여야 하는 범위 — 뷰마다 다르다. */
export function visibleRange(anchor: Date, view: ViewMode): { from: Date; to: Date } {
  if (view === "month") {
    const from = startOfMonthGrid(anchor);
    return { from, to: addDays(from, 42) }; // 6주 격자
  }
  if (view === "week") {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 7) };
  }
  if (view === "day") {
    const from = startOfDay(anchor);
    return { from, to: addDays(from, 1) };
  }
  // agenda — 앞으로 30일
  const from = startOfDay(anchor);
  return { from, to: addDays(from, 30) };
}

export function rangeTitle(anchor: Date, view: ViewMode): string {
  if (view === "month") {
    return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  if (view === "week") {
    const from = startOfWeek(anchor);
    const to = addDays(from, 6);
    const sameMonth = from.getMonth() === to.getMonth();
    return sameMonth
      ? `${from.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${to.getDate()}, ${to.getFullYear()}`
      : `${from.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${to.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  }
  if (view === "day") {
    return anchor.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }
  return "Next 30 days";
}

export function shiftAnchor(anchor: Date, view: ViewMode, direction: -1 | 1): Date {
  if (view === "month") return addMonths(anchor, direction);
  if (view === "week") return addDays(anchor, 7 * direction);
  return addDays(anchor, direction);
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** `<input type="datetime-local">` 이 요구하는 로컬 시각 문자열. */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** `<input type="date">` 용 — 종일 일정은 UTC 자정 기준이라 UTC 로 읽는다. */
export function toDateInputUtc(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * 시각이 있는 일정을 종일로 바꿀 때 쓰는 "그 사람이 보고 있는 날짜".
 * 이때 UTC 로 읽으면 안 된다 — 서울에서 오전 8시로 잡은 일정은 UTC 로는 전날
 * 23시라, 종일로 바꾸는 순간 하루 앞으로 밀려 버린다.
 */
export function toDateInputLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "2026-07-27" → 그 날 UTC 자정. 종일 일정 저장용. */
export function fromDateInputUtc(value: string, endOfIt = false): Date | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return endOfIt
    ? new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 23, 59, 59))
    : new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
}
