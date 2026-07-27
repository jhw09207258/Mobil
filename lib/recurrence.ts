// ============================================================================
// 반복 일정 전개 — RFC 5545 RRULE 의 실용적인 부분집합.
// ----------------------------------------------------------------------------
// 반복 일정을 DB 에 발생일마다 한 행씩 저장하지 않는 이유는 0066 migration 의
// 주석에 적어 두었다. 규칙만 저장하고, 화면에 보이는 기간만큼 여기서 편다.
//
// 지원하는 것 — Google/Apple/Outlook 의 반복 UI 가 실제로 만들어 내는 조합:
//   FREQ=DAILY|WEEKLY|MONTHLY|YEARLY
//   INTERVAL=<n>            n 일/주/달/해마다
//   BYDAY=MO,WE,FR          주간 반복에서 어떤 요일에(주간에만 적용)
//   COUNT=<n>               n 번만
// UNTIL 은 RRULE 문자열이 아니라 calendar_events.recurrence_until 컬럼에 있다
// (조회 범위를 SQL 에서 좁히는 데 그 값이 필요하기 때문).
//
// 시간대에 대하여: 전개는 실행 중인 환경의 로컬 시간대로 이루어진다. 그래서
// "매주 화요일 09:00" 은 서머타임이 시작돼도 보는 사람의 09:00 에 그대로
// 머무른다. 다른 시간대에서 만든 반복 일정을 볼 때 요일이 어긋나 보일 수
// 있는데(예: 서울 08:00 을 뉴욕에서 보면 전날), 이는 시각을 옮기지 않고
// 정확히 표시한 결과다 — 원 시간대는 calendar_events.time_zone 에 남아 있다.
// ============================================================================

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export type RecurrenceRule = {
  freq: Freq;
  /** 1 이상. 파싱 실패/누락 시 1. */
  interval: number;
  /** 0=일 … 6=토. WEEKLY 에만 의미가 있고, 비어 있으면 시작일의 요일. */
  byDay: number[];
  /** 총 발생 횟수 상한. null 이면 제한 없음. */
  count: number | null;
};

const FREQS: Freq[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** 한 번의 전개에서 돌려주는 최대 발생 수 — 화면 하나에 그릴 양을 넘지 않는다. */
const MAX_OCCURRENCES = 400;
/** 후보를 넘겨 가며 검사할 최대 횟수 — 끝나지 않는 규칙의 안전장치. */
const MAX_STEPS = 20000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseRecurrence(rule: string | null | undefined): RecurrenceRule | null {
  if (!rule) return null;
  const parts = new Map<string, string>();
  for (const chunk of rule.split(";")) {
    const eq = chunk.indexOf("=");
    if (eq <= 0) continue;
    parts.set(chunk.slice(0, eq).trim().toUpperCase(), chunk.slice(eq + 1).trim().toUpperCase());
  }

  const freq = parts.get("FREQ") as Freq | undefined;
  if (!freq || !FREQS.includes(freq)) return null;

  const intervalRaw = Number.parseInt(parts.get("INTERVAL") ?? "1", 10);
  const interval = Number.isFinite(intervalRaw) && intervalRaw > 0 ? Math.min(intervalRaw, 366) : 1;

  const byDay: number[] = [];
  for (const code of (parts.get("BYDAY") ?? "").split(",")) {
    // "2MO"(둘째 주 월요일) 같은 서수 접두사는 지원하지 않는다 — 요일만 읽는다.
    const day = DAY_CODES.indexOf(code.trim().slice(-2) as (typeof DAY_CODES)[number]);
    if (day >= 0 && !byDay.includes(day)) byDay.push(day);
  }
  byDay.sort((a, b) => a - b);

  const countRaw = Number.parseInt(parts.get("COUNT") ?? "", 10);
  const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.min(countRaw, MAX_OCCURRENCES) : null;

  return { freq, interval, byDay: freq === "WEEKLY" ? byDay : [], count };
}

export function formatRecurrence(rule: RecurrenceRule | null): string | null {
  if (!rule) return null;
  const out = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) out.push(`INTERVAL=${rule.interval}`);
  if (rule.freq === "WEEKLY" && rule.byDay.length > 0) {
    out.push(`BYDAY=${rule.byDay.map((d) => DAY_CODES[d]).join(",")}`);
  }
  if (rule.count) out.push(`COUNT=${rule.count}`);
  return out.join(";");
}

/** 사람이 읽는 한 줄 요약 — "Every 2 weeks on Mon, Wed". */
export function describeRecurrence(
  rule: string | RecurrenceRule | null | undefined,
  start?: Date
): string {
  const parsed = typeof rule === "string" || rule == null ? parseRecurrence(rule ?? null) : rule;
  if (!parsed) return "Does not repeat";

  const n = parsed.interval;
  const unit =
    parsed.freq === "DAILY" ? "day" : parsed.freq === "WEEKLY" ? "week" : parsed.freq === "MONTHLY" ? "month" : "year";
  let text = n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;

  if (parsed.freq === "WEEKLY") {
    const days = parsed.byDay.length > 0 ? parsed.byDay : start ? [start.getDay()] : [];
    if (days.length > 0) text += ` on ${days.map((d) => DAY_LABELS[d]).join(", ")}`;
  } else if (parsed.freq === "MONTHLY" && start) {
    text += ` on day ${start.getDate()}`;
  }

  if (parsed.count) text += `, ${parsed.count} times`;
  return text;
}

export type Occurrence = {
  /** 이 발생의 시작. */
  start: Date;
  /** 이 발생의 끝 — 원본 일정의 길이를 그대로 유지한다. */
  end: Date;
  /** 0 = 원본(첫 발생). */
  index: number;
};

export type ExpandInput = {
  startsAt: string | Date;
  endsAt: string | Date;
  recurrence?: string | null;
  recurrenceUntil?: string | Date | null;
  /**
   * 종일 일정은 UTC 자정에 고정해 저장한다(0066 참고). 그런 일정을 로컬
   * 시간대로 전개하면 서머타임 경계에서 하루가 밀리므로, UTC 달력으로 센다.
   */
  allDay?: boolean;
};

/**
 * 로컬/UTC 달력을 같은 모양으로 다루기 위한 얇은 어댑터. 반복 계산은
 * "연·월·일 + 시각" 을 조립하는 일이 전부라, 두 벌을 따로 쓰지 않는다.
 */
type CalendarOps = {
  year: (d: Date) => number;
  month: (d: Date) => number;
  day: (d: Date) => number;
  weekday: (d: Date) => number;
  make: (y: number, mo: number, d: number, h: number, mi: number, s: number, ms: number) => Date;
  hours: (d: Date) => number;
  minutes: (d: Date) => number;
  seconds: (d: Date) => number;
  millis: (d: Date) => number;
};

const LOCAL_CAL: CalendarOps = {
  year: (d) => d.getFullYear(),
  month: (d) => d.getMonth(),
  day: (d) => d.getDate(),
  weekday: (d) => d.getDay(),
  make: (y, mo, d, h, mi, s, ms) => new Date(y, mo, d, h, mi, s, ms),
  hours: (d) => d.getHours(),
  minutes: (d) => d.getMinutes(),
  seconds: (d) => d.getSeconds(),
  millis: (d) => d.getMilliseconds(),
};

const UTC_CAL: CalendarOps = {
  year: (d) => d.getUTCFullYear(),
  month: (d) => d.getUTCMonth(),
  day: (d) => d.getUTCDate(),
  weekday: (d) => d.getUTCDay(),
  make: (y, mo, d, h, mi, s, ms) => new Date(Date.UTC(y, mo, d, h, mi, s, ms)),
  hours: (d) => d.getUTCHours(),
  minutes: (d) => d.getUTCMinutes(),
  seconds: (d) => d.getUTCSeconds(),
  millis: (d) => d.getUTCMilliseconds(),
};

/**
 * [rangeStart, rangeEnd) 와 겹치는 발생만 돌려준다.
 *
 * 반복이 없으면 원본이 범위와 겹칠 때만 한 개. 겹침 판정은 "끝이 범위 시작보다
 * 뒤이고, 시작이 범위 끝보다 앞" — 여러 날에 걸친 일정이 중간 주에서 사라지지
 * 않게 한다.
 */
export function expandOccurrences(
  event: ExpandInput,
  rangeStart: Date,
  rangeEnd: Date
): Occurrence[] {
  const baseStart = toDate(event.startsAt);
  const baseEnd = toDate(event.endsAt);
  if (!baseStart || !baseEnd) return [];

  const durationMs = Math.max(0, baseEnd.getTime() - baseStart.getTime());
  const rule = parseRecurrence(event.recurrence);
  // 범위는 [rangeStart, rangeEnd) 로 본다. 길이가 있는 일정은 반개구간
  // [start, start+duration) 로 겹침을 따지고, 길이가 0 인 순간 일정은
  // 그 시점이 범위 안에 있으면 포함한다 — 그러지 않으면 범위 시작과 정확히
  // 같은 순간의 일정이 어느 범위에도 속하지 않는다.
  const overlaps = (s: Date) =>
    s.getTime() < rangeEnd.getTime() &&
    (durationMs === 0
      ? s.getTime() >= rangeStart.getTime()
      : s.getTime() + durationMs > rangeStart.getTime());

  if (!rule) {
    return overlaps(baseStart) ? [{ start: baseStart, end: baseEnd, index: 0 }] : [];
  }

  const until = toDate(event.recurrenceUntil ?? null);
  const out: Occurrence[] = [];

  // COUNT 이 없으면 발생 번호를 쓸 데가 없다 — 아주 오래전에 시작한 반복이
  // 보고 있는 달까지 한 걸음씩 걸어오느라 MAX_STEPS 를 태우지 않도록 범위
  // 근처까지 건너뛴다. COUNT 이 있으면 번호가 곧 종료 조건이므로 처음부터 센다.
  const skip = rule.count === null ? periodsBefore(rule, baseStart, rangeStart) : 0;
  const cal = event.allDay ? UTC_CAL : LOCAL_CAL;

  for (const { start, index } of candidates(rule, baseStart, skip, cal)) {
    if (rule.count !== null && index >= rule.count) break;
    if (until && start.getTime() > until.getTime()) break;
    // 후보는 시간순이므로, 범위 끝을 넘어선 순간 더 볼 것이 없다.
    if (start.getTime() >= rangeEnd.getTime()) break;

    if (overlaps(start)) {
      out.push({ start, end: new Date(start.getTime() + durationMs), index });
      if (out.length >= MAX_OCCURRENCES) break;
    }
  }

  return out;
}

/**
 * rangeStart 앞에 확실히 놓이는 주기 수 — 건너뛰어도 발생을 놓치지 않는
 * 보수적인 하한이다(한 주기 여유를 두고 깎는다).
 */
function periodsBefore(rule: RecurrenceRule, base: Date, rangeStart: Date): number {
  const gapMs = rangeStart.getTime() - base.getTime();
  if (gapMs <= 0) return 0;
  const per =
    rule.freq === "DAILY"
      ? DAY_MS * rule.interval
      : rule.freq === "WEEKLY"
        ? DAY_MS * 7 * rule.interval
        : rule.freq === "MONTHLY"
          ? DAY_MS * 28 * rule.interval // 달의 최소 길이 — 넘겨 세지 않기 위해
          : DAY_MS * 365 * rule.interval;
  return Math.max(0, Math.floor(gapMs / per) - 1);
}

/**
 * 규칙이 만들어 내는 시작 시각을 시간순으로 흘려보낸다(무한 수열, 호출부가 끊는다).
 * `fromPeriod` 부터 시작하되 `index`(0 = 첫 발생)는 항상 정확히 매긴다.
 */
function* candidates(
  rule: RecurrenceRule,
  base: Date,
  fromPeriod: number,
  cal: CalendarOps
): Generator<{ start: Date; index: number }> {
  const h = cal.hours(base);
  const m = cal.minutes(base);
  const s = cal.seconds(base);
  const ms = cal.millis(base);
  const baseYear = cal.year(base);
  const baseMonth = cal.month(base);
  const baseDay = cal.day(base);
  let steps = 0;

  if (rule.freq === "WEEKLY") {
    const baseWeekday = cal.weekday(base);
    const days = rule.byDay.length > 0 ? rule.byDay : [baseWeekday];
    // 첫 주에서 시작일보다 앞서 버려지는 요일 수 — 발생 번호 계산에 쓴다.
    const skippedInFirstWeek = days.filter((d) => d < baseWeekday).length;
    for (let week = fromPeriod; steps < MAX_STEPS; week += 1) {
      // 기준 주의 일요일에서 INTERVAL 주씩 건너뛴 주의 시작.
      const offset = week * rule.interval * 7 - baseWeekday;
      for (let slot = 0; slot < days.length; slot += 1) {
        const d = cal.make(baseYear, baseMonth, baseDay + offset + days[slot], h, m, s, ms);
        steps += 1;
        // 시작일보다 앞선 요일(첫 주의 앞부분)은 발생이 아니다.
        if (d.getTime() < base.getTime()) continue;
        yield { start: d, index: week * days.length + slot - skippedInFirstWeek };
      }
    }
    return;
  }

  if (rule.freq === "DAILY") {
    for (let i = fromPeriod; steps < MAX_STEPS; i += 1, steps += 1) {
      yield {
        start: cal.make(baseYear, baseMonth, baseDay + i * rule.interval, h, m, s, ms),
        index: i,
      };
    }
    return;
  }

  // MONTHLY / YEARLY — 있지도 않은 날짜(2월 31일, 윤년 아닌 해의 2월 29일)는
  // 건너뛴다. Date 는 넘치는 날짜를 다음 달로 굴려 버리므로 직접 확인하고,
  // 건너뛴 것은 발생 번호에서도 빼야 COUNT 가 RFC 5545 와 같아진다.
  let index = 0;
  for (let i = 0; steps < MAX_STEPS; i += 1, steps += 1) {
    const d =
      rule.freq === "MONTHLY"
        ? cal.make(baseYear, baseMonth + i * rule.interval, baseDay, h, m, s, ms)
        : cal.make(baseYear + i * rule.interval, baseMonth, baseDay, h, m, s, ms);
    if (cal.day(d) !== baseDay) continue;
    if (i >= fromPeriod) yield { start: d, index };
    index += 1;
  }
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
