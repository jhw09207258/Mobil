// 반복 일정 전개 규칙 검증. 실행: node lib/recurrence.test.mjs
// 날짜 계산은 로컬 시간대 기준이라, 여기서도 로컬 Date 로만 기대값을 만든다.
import assert from "node:assert";
import {
  parseRecurrence,
  formatRecurrence,
  describeRecurrence,
  expandOccurrences,
  nextReminderAt,
} from "./recurrence.ts";

const at = (y, mo, d, h = 9, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const starts = (occ) => occ.map((o) => iso(o.start));

// ---------------------------------------------------------------- 파싱
assert.deepEqual(parseRecurrence(null), null);
assert.deepEqual(parseRecurrence(""), null);
assert.deepEqual(parseRecurrence("garbage"), null);
assert.deepEqual(parseRecurrence("FREQ=HOURLY"), null, "지원하지 않는 FREQ 는 거절");

assert.deepEqual(parseRecurrence("FREQ=DAILY"), {
  freq: "DAILY", interval: 1, byDay: [], count: null,
});
assert.deepEqual(parseRecurrence("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5"), {
  freq: "WEEKLY", interval: 2, byDay: [1, 3], count: 5,
});
// 서수 접두사(둘째 주 월요일)는 요일만 읽는다.
assert.deepEqual(parseRecurrence("FREQ=WEEKLY;BYDAY=2MO").byDay, [1]);
// BYDAY 는 주간 반복에만 의미가 있다.
assert.deepEqual(parseRecurrence("FREQ=MONTHLY;BYDAY=MO").byDay, []);
// 말이 안 되는 INTERVAL 은 1 로 되돌린다.
assert.equal(parseRecurrence("FREQ=DAILY;INTERVAL=0").interval, 1);
assert.equal(parseRecurrence("FREQ=DAILY;INTERVAL=-3").interval, 1);
assert.equal(parseRecurrence("FREQ=DAILY;INTERVAL=abc").interval, 1);
// 소문자도 받는다.
assert.equal(parseRecurrence("freq=weekly;byday=fr").freq, "WEEKLY");

// ---------------------------------------------------------------- 직렬화
assert.equal(formatRecurrence(null), null);
assert.equal(formatRecurrence(parseRecurrence("FREQ=DAILY")), "FREQ=DAILY");
assert.equal(
  formatRecurrence(parseRecurrence("FREQ=WEEKLY;INTERVAL=2;BYDAY=WE,MO;COUNT=5")),
  "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5",
  "요일은 정렬되고 기본값(INTERVAL=1)은 빠진다"
);

// ---------------------------------------------------------------- 설명 문구
assert.equal(describeRecurrence(null), "Does not repeat");
assert.equal(describeRecurrence("FREQ=DAILY"), "Every day");
assert.equal(describeRecurrence("FREQ=DAILY;INTERVAL=3"), "Every 3 days");
assert.equal(describeRecurrence("FREQ=WEEKLY;BYDAY=MO,FR"), "Every week on Mon, Fri");
// BYDAY 가 없으면 시작일의 요일을 쓴다 — 2026-07-27 은 월요일.
assert.equal(describeRecurrence("FREQ=WEEKLY", at(2026, 7, 27)), "Every week on Mon");
assert.equal(describeRecurrence("FREQ=MONTHLY", at(2026, 7, 27)), "Every month on day 27");
assert.equal(describeRecurrence("FREQ=DAILY;COUNT=4"), "Every day, 4 times");

// ---------------------------------------------------------------- 단발 일정
{
  const ev = { startsAt: at(2026, 7, 27, 9), endsAt: at(2026, 7, 27, 10) };
  assert.deepEqual(starts(expandOccurrences(ev, at(2026, 7, 1, 0), at(2026, 8, 1, 0))), [
    "2026-07-27 09:00",
  ]);
  // 범위 밖이면 아무것도 없다.
  assert.equal(expandOccurrences(ev, at(2026, 8, 1, 0), at(2026, 9, 1, 0)).length, 0);
}

// 여러 날에 걸친 일정은 중간 범위에서도 보여야 한다.
{
  const ev = { startsAt: at(2026, 7, 1, 9), endsAt: at(2026, 7, 20, 18) };
  assert.equal(
    expandOccurrences(ev, at(2026, 7, 10, 0), at(2026, 7, 12, 0)).length,
    1,
    "시작도 끝도 범위 밖이지만 걸쳐 있으므로 보인다"
  );
}

// ---------------------------------------------------------------- 매일
{
  const ev = { startsAt: at(2026, 7, 27, 9), endsAt: at(2026, 7, 27, 10), recurrence: "FREQ=DAILY" };
  assert.deepEqual(starts(expandOccurrences(ev, at(2026, 7, 27), at(2026, 7, 31))), [
    "2026-07-27 09:00",
    "2026-07-28 09:00",
    "2026-07-29 09:00",
    "2026-07-30 09:00",
  ]);
}

// 이틀마다 + COUNT — 세 번만 나오고 멈춘다.
{
  const ev = {
    startsAt: at(2026, 7, 27, 9),
    endsAt: at(2026, 7, 27, 10),
    recurrence: "FREQ=DAILY;INTERVAL=2;COUNT=3",
  };
  assert.deepEqual(starts(expandOccurrences(ev, at(2026, 7, 1), at(2026, 9, 1))), [
    "2026-07-27 09:00",
    "2026-07-29 09:00",
    "2026-07-31 09:00",
  ]);
}

// UNTIL 은 그 시각 이후를 자른다.
{
  const ev = {
    startsAt: at(2026, 7, 27, 9),
    endsAt: at(2026, 7, 27, 10),
    recurrence: "FREQ=DAILY",
    recurrenceUntil: at(2026, 7, 29, 23, 59),
  };
  assert.deepEqual(starts(expandOccurrences(ev, at(2026, 7, 1), at(2026, 9, 1))), [
    "2026-07-27 09:00",
    "2026-07-28 09:00",
    "2026-07-29 09:00",
  ]);
}

// 아주 오래전에 시작한 매일 반복도 지금 범위에서 보여야 한다(건너뛰기 경로).
{
  const ev = { startsAt: at(2000, 1, 1, 9), endsAt: at(2000, 1, 1, 10), recurrence: "FREQ=DAILY" };
  assert.deepEqual(starts(expandOccurrences(ev, at(2026, 7, 27), at(2026, 7, 29))), [
    "2026-07-27 09:00",
    "2026-07-28 09:00",
  ]);
}

// ---------------------------------------------------------------- 매주
{
  // 2026-07-27 은 월요일. 월/수 반복.
  const ev = {
    startsAt: at(2026, 7, 27, 9),
    endsAt: at(2026, 7, 27, 10),
    recurrence: "FREQ=WEEKLY;BYDAY=MO,WE",
  };
  assert.deepEqual(starts(expandOccurrences(ev, at(2026, 7, 27), at(2026, 8, 10))), [
    "2026-07-27 09:00",
    "2026-07-29 09:00",
    "2026-08-03 09:00",
    "2026-08-05 09:00",
  ]);
}

// 시작일보다 앞선 요일은 첫 주에서 빠진다 — 수요일에 시작한 월/수 반복.
{
  const ev = {
    startsAt: at(2026, 7, 29, 9), // 수요일
    endsAt: at(2026, 7, 29, 10),
    recurrence: "FREQ=WEEKLY;BYDAY=MO,WE",
  };
  assert.deepEqual(starts(expandOccurrences(ev, at(2026, 7, 1), at(2026, 8, 10))), [
    "2026-07-29 09:00",
    "2026-08-03 09:00",
    "2026-08-05 09:00",
  ]);
  // 그리고 COUNT 는 실제로 일어난 발생만 센다.
  const counted = { ...ev, recurrence: "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=2" };
  assert.deepEqual(starts(expandOccurrences(counted, at(2026, 7, 1), at(2026, 9, 1))), [
    "2026-07-29 09:00",
    "2026-08-03 09:00",
  ]);
}

// 격주 — 한 주 걸러 한 번.
{
  const ev = {
    startsAt: at(2026, 7, 27, 9),
    endsAt: at(2026, 7, 27, 10),
    recurrence: "FREQ=WEEKLY;INTERVAL=2",
  };
  assert.deepEqual(starts(expandOccurrences(ev, at(2026, 7, 1), at(2026, 9, 1))), [
    "2026-07-27 09:00",
    "2026-08-10 09:00",
    "2026-08-24 09:00",
  ]);
}

// ---------------------------------------------------------------- 매달 / 매년
{
  const ev = { startsAt: at(2026, 1, 15, 9), endsAt: at(2026, 1, 15, 10), recurrence: "FREQ=MONTHLY" };
  assert.deepEqual(starts(expandOccurrences(ev, at(2026, 1, 1), at(2026, 4, 1))), [
    "2026-01-15 09:00",
    "2026-02-15 09:00",
    "2026-03-15 09:00",
  ]);
}

// 31일 반복은 31일이 없는 달을 건너뛴다(2월/4월/6월…).
{
  const ev = { startsAt: at(2026, 1, 31, 9), endsAt: at(2026, 1, 31, 10), recurrence: "FREQ=MONTHLY" };
  assert.deepEqual(starts(expandOccurrences(ev, at(2026, 1, 1), at(2026, 6, 1))), [
    "2026-01-31 09:00",
    "2026-03-31 09:00",
    "2026-05-31 09:00",
  ]);
  // 건너뛴 달은 COUNT 에도 들어가지 않는다.
  const counted = { ...ev, recurrence: "FREQ=MONTHLY;COUNT=2" };
  assert.deepEqual(starts(expandOccurrences(counted, at(2026, 1, 1), at(2027, 1, 1))), [
    "2026-01-31 09:00",
    "2026-03-31 09:00",
  ]);
}

// 2월 29일 매년 반복은 윤년에만 일어난다.
{
  const ev = { startsAt: at(2028, 2, 29, 9), endsAt: at(2028, 2, 29, 10), recurrence: "FREQ=YEARLY" };
  assert.deepEqual(starts(expandOccurrences(ev, at(2028, 1, 1), at(2034, 1, 1))), [
    "2028-02-29 09:00",
    "2032-02-29 09:00",
  ]);
}

// ---------------------------------------------------------------- 종일 일정
// 종일 일정은 UTC 자정에 고정 저장되고 UTC 달력으로 전개된다 — 이 테스트가
// 실행되는 시간대와 무관하게 매일 UTC 자정이어야 한다.
{
  const utc = (y, mo, d, h = 0) => new Date(Date.UTC(y, mo - 1, d, h, 0, 0, 0));
  const ev = {
    startsAt: utc(2026, 7, 27),
    endsAt: utc(2026, 7, 27, 23),
    allDay: true,
    recurrence: "FREQ=DAILY",
  };
  const occ = expandOccurrences(ev, utc(2026, 7, 27), utc(2026, 7, 30));
  assert.deepEqual(
    occ.map((o) => o.start.toISOString()),
    [
      "2026-07-27T00:00:00.000Z",
      "2026-07-28T00:00:00.000Z",
      "2026-07-29T00:00:00.000Z",
    ]
  );
}

// 종일 주간 반복도 UTC 요일로 센다.
{
  const utc = (y, mo, d) => new Date(Date.UTC(y, mo - 1, d));
  const ev = {
    startsAt: utc(2026, 7, 27), // UTC 기준 월요일
    endsAt: utc(2026, 7, 27),
    allDay: true,
    recurrence: "FREQ=WEEKLY;BYDAY=MO,FR",
  };
  const occ = expandOccurrences(ev, utc(2026, 7, 27), utc(2026, 8, 8));
  assert.deepEqual(
    occ.map((o) => o.start.toISOString().slice(0, 10)),
    ["2026-07-27", "2026-07-31", "2026-08-03", "2026-08-07"]
  );
}

// ---------------------------------------------------------------- 시간대
// 반복은 만든 사람의 시간대(벽시계)로 전개된다. 아래 기대값은 이 테스트가
// 어느 시간대에서 돌든 같아야 한다 — 그것이 이 기능의 요점이다.
{
  // 서울에서 매주 월요일 09:00 으로 만든 일정 = 00:00Z (서울은 UTC+9, DST 없음).
  const ev = {
    startsAt: "2026-07-27T00:00:00Z",
    endsAt: "2026-07-27T01:00:00Z",
    timeZone: "Asia/Seoul",
    recurrence: "FREQ=WEEKLY;BYDAY=MO",
  };
  const occ = expandOccurrences(ev, new Date("2026-07-20T00:00:00Z"), new Date("2026-08-18T00:00:00Z"));
  assert.deepEqual(
    occ.map((o) => o.start.toISOString()),
    [
      "2026-07-27T00:00:00.000Z",
      "2026-08-03T00:00:00.000Z",
      "2026-08-10T00:00:00.000Z",
      "2026-08-17T00:00:00.000Z",
    ],
    "서울 기준 매주 월요일이 유지된다"
  );
}

// 서머타임이 있는 시간대에서는 절대시각이 바뀌면서 벽시계가 유지되어야 한다.
{
  // 뉴욕에서 매일 09:00. 2026-11-01 에 서머타임이 끝난다(EDT -4 → EST -5).
  const ev = {
    startsAt: "2026-10-30T13:00:00Z", // = 09:00 EDT
    endsAt: "2026-10-30T14:00:00Z",
    timeZone: "America/New_York",
    recurrence: "FREQ=DAILY",
  };
  const occ = expandOccurrences(ev, new Date("2026-10-30T00:00:00Z"), new Date("2026-11-04T00:00:00Z"));
  const wall = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (const o of occ) {
    assert.equal(wall.format(o.start), "09:00", "서머타임 전환에도 현지 09:00 유지");
  }
  // 전환 뒤에는 UTC 시각이 한 시간 밀린다 — 그것이 벽시계를 지킨 증거다.
  assert.equal(occ[0].start.toISOString(), "2026-10-30T13:00:00.000Z");
  assert.equal(occ[occ.length - 1].start.toISOString(), "2026-11-03T14:00:00.000Z");
}

// 알 수 없는 시간대 이름이 저장돼 있어도 일정이 사라지지 않는다.
{
  const ev = {
    startsAt: at(2026, 7, 27, 9),
    endsAt: at(2026, 7, 27, 10),
    timeZone: "Not/AZone",
    recurrence: "FREQ=DAILY",
  };
  assert.equal(expandOccurrences(ev, at(2026, 7, 27), at(2026, 7, 30)).length, 3);
}

// ---------------------------------------------------------------- 발생 예외
// "이 일정만 삭제" 는 규칙을 건드리지 않고 그 발생만 뺀다.
{
  const ev = {
    startsAt: at(2026, 7, 27, 9),
    endsAt: at(2026, 7, 27, 10),
    recurrence: "FREQ=DAILY",
    exceptions: [at(2026, 7, 28, 9)],
  };
  assert.deepEqual(starts(expandOccurrences(ev, at(2026, 7, 27), at(2026, 7, 31))), [
    "2026-07-27 09:00",
    "2026-07-29 09:00",
    "2026-07-30 09:00",
  ]);
}
// 예외는 ISO 문자열로도 받는다(DB 에서 그대로 내려온다).
{
  const ev = {
    startsAt: "2026-07-27T00:00:00Z",
    endsAt: "2026-07-27T01:00:00Z",
    timeZone: "UTC",
    recurrence: "FREQ=DAILY",
    exceptions: ["2026-07-28T00:00:00.000Z"],
  };
  const occ = expandOccurrences(ev, new Date("2026-07-27T00:00:00Z"), new Date("2026-07-30T00:00:00Z"));
  assert.deepEqual(occ.map((o) => o.start.toISOString()), [
    "2026-07-27T00:00:00.000Z",
    "2026-07-29T00:00:00.000Z",
  ]);
}
// 규칙이 만들지 않는 시각을 예외로 넣어도 아무 일도 없다.
{
  const ev = {
    startsAt: at(2026, 7, 27, 9),
    endsAt: at(2026, 7, 27, 10),
    recurrence: "FREQ=DAILY",
    exceptions: [at(2026, 7, 28, 11)],
  };
  assert.equal(expandOccurrences(ev, at(2026, 7, 27), at(2026, 7, 30)).length, 3);
}

// ---------------------------------------------------------------- 알림 예약
{
  const base = {
    startsAt: at(2026, 7, 27, 9),
    endsAt: at(2026, 7, 27, 10),
    recurrence: "FREQ=DAILY",
    reminderMinutes: 10,
  };
  // 27일 08:00 기준 → 그 날 08:50.
  assert.equal(iso(nextReminderAt(base, at(2026, 7, 27, 8))), "2026-07-27 08:50");
  // 알림 시각이 이미 지났으면 다음 발생으로 넘어간다.
  assert.equal(iso(nextReminderAt(base, at(2026, 7, 27, 8, 55))), "2026-07-28 08:50");
  // 알림을 끄면 예약이 없다.
  assert.equal(nextReminderAt({ ...base, reminderMinutes: null }, at(2026, 7, 27, 8)), null);
  // 반복이 끝났으면 예약이 없다.
  assert.equal(
    nextReminderAt(
      { ...base, recurrenceUntil: at(2026, 7, 27, 23, 59) },
      at(2026, 7, 28, 0)
    ),
    null
  );
  // 예외로 뺀 발생은 알리지 않는다.
  assert.equal(
    iso(nextReminderAt({ ...base, exceptions: [at(2026, 7, 28, 9)] }, at(2026, 7, 27, 8, 55))),
    "2026-07-29 08:50"
  );
  // 단발 일정도 동작한다.
  assert.equal(
    iso(nextReminderAt({ startsAt: at(2026, 7, 27, 9), endsAt: at(2026, 7, 27, 10), reminderMinutes: 30 }, at(2026, 7, 1))),
    "2026-07-27 08:30"
  );
}

// ---------------------------------------------------------------- 방어
// 끝이 시작보다 빠른 값이 들어와도 터지지 않는다(길이 0 으로 본다).
{
  const ev = { startsAt: at(2026, 7, 27, 10), endsAt: at(2026, 7, 27, 9) };
  assert.equal(expandOccurrences(ev, at(2026, 7, 1), at(2026, 8, 1)).length, 1);
}
// 날짜가 아닌 값은 빈 배열.
assert.deepEqual(expandOccurrences({ startsAt: "nope", endsAt: "nope" }, at(2026, 1, 1), at(2027, 1, 1)), []);

// ---------------------------------------------------------------- 오래된 반복
// 아주 오래전에 시작한 반복 일정도 지금 구간에서 정확히 전개돼야 한다.
// periodsBefore() 가 "건너뛸 주기 수"를 셀 때 주기 길이를 최솟값(달=28일)으로
// 잡으면 실제보다 앞질러 세어 발생이 조용히 사라졌다 — 3년 된 매월 일정은
// 절반이, 6년 된 일정은 전부 안 보였다. 주기 길이는 최댓값이어야 한다.
for (const startYear of [2019, 2022, 2024]) {
  const ev = {
    startsAt: at(startYear, 1, 15, 9),
    endsAt: at(startYear, 1, 15, 10),
    recurrence: "FREQ=MONTHLY",
  };
  assert.deepEqual(
    starts(expandOccurrences(ev, at(2026, 1, 1), at(2026, 3, 1))),
    ["2026-01-15 09:00", "2026-02-15 09:00"],
    `${startYear} 년에 시작한 매월 일정도 2026-01/02 에 그대로 나와야 함`
  );
}
// 매년 반복도 같은 이유로 해 길이를 366 일(최댓값)로 잡아야 한다.
{
  const ev = { startsAt: at(2005, 6, 10, 9), endsAt: at(2005, 6, 10, 10), recurrence: "FREQ=YEARLY" };
  assert.deepEqual(starts(expandOccurrences(ev, at(2026, 6, 1), at(2026, 7, 1))), ["2026-06-10 09:00"]);
}

console.log("recurrence: all assertions passed");
