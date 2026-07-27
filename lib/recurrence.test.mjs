// 반복 일정 전개 규칙 검증. 실행: node lib/recurrence.test.mjs
// 날짜 계산은 로컬 시간대 기준이라, 여기서도 로컬 Date 로만 기대값을 만든다.
import assert from "node:assert";
import {
  parseRecurrence,
  formatRecurrence,
  describeRecurrence,
  expandOccurrences,
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

// ---------------------------------------------------------------- 방어
// 끝이 시작보다 빠른 값이 들어와도 터지지 않는다(길이 0 으로 본다).
{
  const ev = { startsAt: at(2026, 7, 27, 10), endsAt: at(2026, 7, 27, 9) };
  assert.equal(expandOccurrences(ev, at(2026, 7, 1), at(2026, 8, 1)).length, 1);
}
// 날짜가 아닌 값은 빈 배열.
assert.deepEqual(expandOccurrences({ startsAt: "nope", endsAt: "nope" }, at(2026, 1, 1), at(2027, 1, 1)), []);

console.log("recurrence: all assertions passed");
