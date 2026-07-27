// ============================================================================
// iCalendar(.ics, RFC 5545) 읽기/쓰기 — Google · Apple · Outlook 과의 접점.
// ----------------------------------------------------------------------------
// 라이브러리를 넣지 않는 이유는 lib/email.ts 와 같다. 우리가 쓰는 속성은
// 열 몇 개뿐이고, 그 대신 이 형식에서 실제로 사람을 무는 세 가지만 정확히
// 지킨다.
//
//   1) 줄 접기(folding). 한 줄은 75 옥텟을 넘으면 안 되고, 이어지는 줄은
//      공백 하나로 시작한다. 읽을 때는 그 반대로 이어 붙인다. UTF-8 이라
//      "글자 수" 가 아니라 "바이트 수" 로 세야 한글 제목에서 깨지지 않는다.
//   2) 이스케이프. 쉼표·세미콜론·역슬래시·줄바꿈은 값 안에서 특별한 뜻을
//      가지므로 반드시 escape 한다.
//   3) 종일 일정의 끝은 배타적(exclusive)이다. 7월 27일 하루짜리 일정의
//      DTEND 는 7월 28일이다. 이걸 틀리면 모든 종일 일정이 하루씩 길어진다.
// ============================================================================

export type IcsEvent = {
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  /** ISO 문자열 또는 Date. */
  startsAt: string | Date;
  endsAt: string | Date;
  allDay?: boolean;
  /** 우리 RRULE 부분집합(FREQ=…). UNTIL 은 recurrenceUntil 로 따로 준다. */
  recurrence?: string | null;
  recurrenceUntil?: string | Date | null;
  status?: string | null;
  updatedAt?: string | Date | null;
};

const CRLF = "\r\n";

// ---------------------------------------------------------------- 내보내기

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** UTC 기준 20260727T090000Z. */
export function toIcsDateTime(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** 종일 일정용 20260727 (날짜만). */
export function toIcsDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * 75 옥텟마다 접는다. 문자를 중간에서 자르면 안 되므로 UTF-8 바이트 길이를
 * 세면서 코드 포인트 단위로 끊는다.
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = "";
  let bytes = 0;
  // 이어지는 줄은 앞의 공백 한 칸이 이미 1 옥텟을 쓴다.
  let limit = 75;

  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
      limit = 74;
    }
    current += ch;
    bytes += size;
  }
  if (current) out.push(current);
  return out.join(`${CRLF} `);
}

function prop(name: string, value: string): string {
  return foldIcsLine(`${name}:${value}`);
}

/**
 * VCALENDAR 문자열. `feedName` 은 구독한 캘린더 앱에 보이는 이름이다.
 * 반복 일정은 규칙 그대로 내보낸다 — 상대 캘린더가 전개한다.
 */
export function buildIcs(events: IcsEvent[], feedName = "Possion"): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Possion//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    prop("X-WR-CALNAME", escapeIcsText(feedName)),
    // 구독 측이 다시 긁어 가는 간격 힌트(Google/Apple 모두 참고한다).
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  const stamp = toIcsDateTime(new Date());

  for (const e of events) {
    const start = e.startsAt instanceof Date ? e.startsAt : new Date(e.startsAt);
    const end = e.endsAt instanceof Date ? e.endsAt : new Date(e.endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;

    lines.push("BEGIN:VEVENT");
    lines.push(prop("UID", e.uid));
    lines.push(prop("DTSTAMP", stamp));

    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${toIcsDate(start)}`);
      // 끝은 배타적이다 — 마지막 날의 다음 날을 적는다. 시작과 끝이 같은 날인
      // 하루짜리도 반드시 하루를 더해야 한다.
      const exclusive = new Date(end.getTime());
      exclusive.setUTCDate(exclusive.getUTCDate() + 1);
      lines.push(`DTEND;VALUE=DATE:${toIcsDate(exclusive)}`);
    } else {
      lines.push(prop("DTSTART", toIcsDateTime(start)));
      lines.push(prop("DTEND", toIcsDateTime(end)));
    }

    lines.push(prop("SUMMARY", escapeIcsText(e.title || "Untitled")));
    if (e.description) lines.push(prop("DESCRIPTION", escapeIcsText(e.description)));
    if (e.location) lines.push(prop("LOCATION", escapeIcsText(e.location)));
    if (e.url) lines.push(prop("URL", e.url));
    if (e.status) lines.push(prop("STATUS", e.status.toUpperCase()));
    if (e.updatedAt) lines.push(prop("LAST-MODIFIED", toIcsDateTime(e.updatedAt)));

    const rrule = buildRruleValue(e.recurrence, e.recurrenceUntil);
    if (rrule) lines.push(prop("RRULE", rrule));

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join(CRLF) + CRLF;
}

function buildRruleValue(
  recurrence: string | null | undefined,
  until: string | Date | null | undefined
): string | null {
  const rule = (recurrence ?? "").trim();
  if (!rule) return null;
  if (!until) return rule;
  const d = until instanceof Date ? until : new Date(until);
  if (Number.isNaN(d.getTime())) return rule;
  return `${rule};UNTIL=${toIcsDateTime(d)}`;
}

// ---------------------------------------------------------------- 읽기

export type ParsedIcsEvent = {
  uid: string | null;
  title: string;
  description: string | null;
  location: string | null;
  url: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  /** 우리가 지원하는 부분만 남긴 RRULE. 지원 밖이면 null. */
  recurrence: string | null;
  recurrenceUntil: Date | null;
  status: string | null;
};

/** 접힌 줄을 원래대로 이어 붙인다. */
export function unfoldIcs(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

export function unescapeIcsText(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] !== "\\") {
      out += value[i];
      continue;
    }
    const next = value[i + 1];
    if (next === "n" || next === "N") out += "\n";
    else if (next === undefined) out += "\\";
    else out += next;
    i += 1;
  }
  return out;
}

/** `DTSTART;TZID=Asia/Seoul` → { name, params }. */
function splitPropName(head: string): { name: string; params: Map<string, string> } {
  const bits = head.split(";");
  const params = new Map<string, string>();
  for (const p of bits.slice(1)) {
    const eq = p.indexOf("=");
    if (eq > 0) params.set(p.slice(0, eq).toUpperCase(), p.slice(eq + 1).replace(/^"|"$/g, ""));
  }
  return { name: bits[0].toUpperCase(), params };
}

/**
 * ICS 의 날짜/시간을 Date 로.
 *   20260727            → 그 날 00:00 (로컬)
 *   20260727T090000Z    → UTC
 *   20260727T090000     → 로컬(TZID 가 있어도 그 시간대로 해석하진 않는다 —
 *                         Intl 없이 IANA 시간대를 다루는 건 이 파일의 범위를
 *                         넘는다. 대신 "적힌 시각 그대로" 를 지킨다.)
 */
export function parseIcsDate(value: string): { date: Date; dateOnly: boolean } | null {
  const v = value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, z] = m;
  if (!hh) {
    return { date: new Date(Number(y), Number(mo) - 1, Number(d), 0, 0, 0, 0), dateOnly: true };
  }
  const date = z
    ? new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss)))
    : new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  return Number.isNaN(date.getTime()) ? null : { date, dateOnly: false };
}

const SUPPORTED_FREQ = new Set(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);

/** 외부 RRULE 에서 우리가 다룰 수 있는 부분만 남긴다. UNTIL 은 따로 뽑는다. */
export function narrowRrule(value: string): { rule: string | null; until: Date | null } {
  const parts = new Map<string, string>();
  for (const chunk of value.split(";")) {
    const eq = chunk.indexOf("=");
    if (eq > 0) parts.set(chunk.slice(0, eq).trim().toUpperCase(), chunk.slice(eq + 1).trim());
  }

  const freq = (parts.get("FREQ") ?? "").toUpperCase();
  if (!SUPPORTED_FREQ.has(freq)) return { rule: null, until: null };

  const out = [`FREQ=${freq}`];
  const interval = Number.parseInt(parts.get("INTERVAL") ?? "1", 10);
  if (Number.isFinite(interval) && interval > 1) out.push(`INTERVAL=${Math.min(interval, 366)}`);
  const byDay = parts.get("BYDAY");
  if (freq === "WEEKLY" && byDay) {
    // 서수 접두사(1MO 등)는 떼고 요일만 남긴다 — 전개기가 요일만 본다.
    const days = byDay
      .split(",")
      .map((d) => d.trim().toUpperCase().slice(-2))
      .filter((d) => ["SU", "MO", "TU", "WE", "TH", "FR", "SA"].includes(d));
    if (days.length > 0) out.push(`BYDAY=${[...new Set(days)].join(",")}`);
  }
  const count = Number.parseInt(parts.get("COUNT") ?? "", 10);
  if (Number.isFinite(count) && count > 0) out.push(`COUNT=${Math.min(count, 400)}`);

  const untilRaw = parts.get("UNTIL");
  const until = untilRaw ? (parseIcsDate(untilRaw)?.date ?? null) : null;

  return { rule: out.join(";"), until };
}

/**
 * .ics 본문에서 VEVENT 를 뽑는다. 우리가 저장할 수 없는 것(첨부, 참석자,
 * 예외 발생일 등)은 조용히 버린다 — 가져오기는 "읽을 수 있는 만큼" 이 원칙이다.
 */
export function parseIcs(text: string): ParsedIcsEvent[] {
  const lines = unfoldIcs(text);
  const events: ParsedIcsEvent[] = [];

  let inEvent = false;
  let cur: Record<string, { value: string; params: Map<string, string> }> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toUpperCase() === "BEGIN:VEVENT") {
      inEvent = true;
      cur = {};
      continue;
    }
    if (trimmed.toUpperCase() === "END:VEVENT") {
      inEvent = false;
      const built = buildParsedEvent(cur);
      if (built) events.push(built);
      // 파일 하나에 수천 개가 들어오는 경우를 대비한 상한.
      if (events.length >= 1000) break;
      continue;
    }
    if (!inEvent) continue;

    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const { name, params } = splitPropName(line.slice(0, colon));
    cur[name] = { value: line.slice(colon + 1), params };
  }

  return events;
}

function buildParsedEvent(
  props: Record<string, { value: string; params: Map<string, string> }>
): ParsedIcsEvent | null {
  const dtstart = props["DTSTART"];
  if (!dtstart) return null;
  const start = parseIcsDate(dtstart.value);
  if (!start) return null;

  const allDay = start.dateOnly || dtstart.params.get("VALUE") === "DATE";

  let end = props["DTEND"] ? parseIcsDate(props["DTEND"].value) : null;
  if (!end && props["DURATION"]) {
    const ms = parseIcsDuration(props["DURATION"].value);
    if (ms !== null) end = { date: new Date(start.date.getTime() + ms), dateOnly: allDay };
  }
  let endDate = end?.date ?? new Date(start.date.getTime() + (allDay ? 0 : 60 * 60 * 1000));

  // 종일 일정의 DTEND 는 배타적이다 — 하루를 되돌려 "마지막 날" 로 만든다.
  if (allDay && end) {
    const back = new Date(endDate.getTime());
    back.setDate(back.getDate() - 1);
    endDate = back.getTime() >= start.date.getTime() ? back : start.date;
  }
  if (endDate.getTime() < start.date.getTime()) endDate = start.date;

  const rrule = props["RRULE"] ? narrowRrule(props["RRULE"].value) : { rule: null, until: null };

  const title = props["SUMMARY"] ? unescapeIcsText(props["SUMMARY"].value).trim() : "";

  return {
    uid: props["UID"]?.value.trim() || null,
    title: title.slice(0, 200) || "Untitled",
    description: props["DESCRIPTION"] ? unescapeIcsText(props["DESCRIPTION"].value).slice(0, 5000) : null,
    location: props["LOCATION"] ? unescapeIcsText(props["LOCATION"].value).slice(0, 300) : null,
    url: props["URL"]?.value.trim() || null,
    startsAt: start.date,
    endsAt: endDate,
    allDay,
    recurrence: rrule.rule,
    recurrenceUntil: rrule.until,
    status: props["STATUS"]?.value.trim().toLowerCase() || null,
  };
}

/** PT1H30M / P1D 같은 ISO 8601 기간 — 우리가 쓰는 범위(일/시/분/초)만. */
export function parseIcsDuration(value: string): number | null {
  const m = value
    .trim()
    .toUpperCase()
    .match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  const ms =
    (Number(w ?? 0) * 7 * 24 * 60 * 60 +
      Number(d ?? 0) * 24 * 60 * 60 +
      Number(h ?? 0) * 60 * 60 +
      Number(mi ?? 0) * 60 +
      Number(s ?? 0)) *
    1000;
  return sign === "-" ? -ms : ms;
}
