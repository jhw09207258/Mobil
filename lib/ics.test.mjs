// iCalendar 읽기/쓰기 검증. 실행: node lib/ics.test.mjs
// 외부 캘린더와 주고받는 형식이라, 틀리면 조용히 하루씩 밀리거나 글자가
// 깨지는 종류의 버그가 난다 — 그 지점들을 집중해서 본다.
import assert from "node:assert";
import {
  buildIcs,
  parseIcs,
  unfoldIcs,
  foldIcsLine,
  escapeIcsText,
  unescapeIcsText,
  parseIcsDate,
  parseIcsDuration,
  narrowRrule,
  toIcsDateTime,
  toIcsDate,
} from "./ics.ts";

const utc = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(Date.UTC(y, mo - 1, d, h, mi, s));

// ---------------------------------------------------------------- 날짜 표기
assert.equal(toIcsDateTime(utc(2026, 7, 27, 9, 5, 3)), "20260727T090503Z");
assert.equal(toIcsDate(utc(2026, 7, 27)), "20260727");

// ---------------------------------------------------------------- 이스케이프
assert.equal(escapeIcsText("a,b;c\\d"), "a\\,b\\;c\\\\d");
assert.equal(escapeIcsText("line1\nline2"), "line1\\nline2");
assert.equal(unescapeIcsText("a\\,b\\;c\\\\d"), "a,b;c\\d");
assert.equal(unescapeIcsText("line1\\nline2"), "line1\nline2");
// 왕복.
for (const s of ["plain", "a,b", "a;b", "back\\slash", "multi\nline", "혼합, 한글;텍스트"]) {
  assert.equal(unescapeIcsText(escapeIcsText(s)), s, `왕복 실패: ${s}`);
}

// ---------------------------------------------------------------- 줄 접기
assert.equal(foldIcsLine("SUMMARY:short"), "SUMMARY:short");
{
  const long = "SUMMARY:" + "x".repeat(200);
  const folded = foldIcsLine(long);
  const lines = folded.split("\r\n");
  assert.ok(lines.length > 1, "길면 접힌다");
  assert.ok(lines[0].length <= 75);
  for (const l of lines.slice(1)) {
    assert.ok(l.startsWith(" "), "이어지는 줄은 공백으로 시작");
    assert.ok(Buffer.byteLength(l, "utf8") <= 75);
  }
  // 접었다 펴면 원본.
  assert.equal(unfoldIcs(folded)[0], long);
}
{
  // 한글은 3바이트다 — 글자 중간에서 잘리면 안 된다.
  const long = "SUMMARY:" + "회의".repeat(80);
  const folded = foldIcsLine(long);
  for (const l of folded.split("\r\n")) {
    assert.ok(Buffer.byteLength(l, "utf8") <= 75, "75 옥텟 이하");
  }
  assert.equal(unfoldIcs(folded)[0], long, "한글도 손실 없이 복원");
}

// ---------------------------------------------------------------- 펼치기
assert.deepEqual(unfoldIcs("A:1\r\nB:2\r\n C\r\nD:3"), ["A:1", "B:2C", "D:3"]);
assert.deepEqual(unfoldIcs("A:1\nB:2\n\tC"), ["A:1", "B:2C"]);

// ---------------------------------------------------------------- 날짜 파싱
assert.deepEqual(parseIcsDate("20260727T090000Z"), { date: utc(2026, 7, 27, 9), dateOnly: false });
assert.equal(parseIcsDate("20260727").dateOnly, true);
assert.equal(parseIcsDate("nonsense"), null);
assert.equal(parseIcsDate(""), null);

// ---------------------------------------------------------------- DURATION
assert.equal(parseIcsDuration("PT1H"), 3600000);
assert.equal(parseIcsDuration("PT1H30M"), 5400000);
assert.equal(parseIcsDuration("P1D"), 86400000);
assert.equal(parseIcsDuration("P1W"), 604800000);
assert.equal(parseIcsDuration("garbage"), null);

// ---------------------------------------------------------------- RRULE 좁히기
assert.deepEqual(narrowRrule("FREQ=DAILY").rule, "FREQ=DAILY");
assert.deepEqual(narrowRrule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE").rule, "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE");
// 서수 접두사는 요일만 남긴다.
assert.deepEqual(narrowRrule("FREQ=WEEKLY;BYDAY=1MO,-1FR").rule, "FREQ=WEEKLY;BYDAY=MO,FR");
// 우리가 못 다루는 주기는 통째로 버린다(반복 없는 일정으로 들어온다).
assert.equal(narrowRrule("FREQ=HOURLY;INTERVAL=6").rule, null);
assert.equal(narrowRrule("nonsense").rule, null);
// 월간 반복의 BYDAY 는 무시한다.
assert.equal(narrowRrule("FREQ=MONTHLY;BYDAY=MO").rule, "FREQ=MONTHLY");
// UNTIL 은 규칙에서 떼어 따로 돌려준다.
{
  const r = narrowRrule("FREQ=DAILY;UNTIL=20260801T000000Z");
  assert.equal(r.rule, "FREQ=DAILY");
  assert.equal(r.until.toISOString(), "2026-08-01T00:00:00.000Z");
}

// ---------------------------------------------------------------- 내보내기
{
  const ics = buildIcs(
    [
      {
        uid: "e1@possion",
        title: "Weekly sync",
        description: "Agenda: 1, 2; and 3",
        location: "Room A",
        startsAt: utc(2026, 7, 27, 9),
        endsAt: utc(2026, 7, 27, 10),
        recurrence: "FREQ=WEEKLY;BYDAY=MO",
        recurrenceUntil: utc(2026, 12, 31),
        status: "confirmed",
      },
    ],
    "Possion — Team"
  );

  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.trimEnd().endsWith("END:VCALENDAR"));
  assert.ok(ics.includes("DTSTART:20260727T090000Z"));
  assert.ok(ics.includes("DTEND:20260727T100000Z"));
  assert.ok(ics.includes("RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231T000000Z"));
  assert.ok(ics.includes("DESCRIPTION:Agenda: 1\\, 2\\; and 3"), "설명은 escape 된다");
  assert.ok(ics.includes("STATUS:CONFIRMED"));
}

// 종일 일정: DTEND 는 배타적이라 하루 뒤가 찍힌다.
{
  const ics = buildIcs([
    {
      uid: "e2@possion",
      title: "Holiday",
      startsAt: utc(2026, 7, 27),
      endsAt: utc(2026, 7, 27, 23, 59, 59),
      allDay: true,
    },
  ]);
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20260727"), ics);
  assert.ok(ics.includes("DTEND;VALUE=DATE:20260728"), "하루짜리의 끝은 다음 날");
}

// 잘못된 날짜의 일정은 조용히 빠진다 — 피드 하나가 통째로 깨지면 안 된다.
{
  const ics = buildIcs([
    { uid: "bad", title: "Broken", startsAt: "nope", endsAt: "nope" },
    { uid: "ok", title: "Fine", startsAt: utc(2026, 7, 27, 9), endsAt: utc(2026, 7, 27, 10) },
  ]);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 1);
  assert.ok(ics.includes("SUMMARY:Fine"));
}

// ---------------------------------------------------------------- 왕복
{
  const original = {
    uid: "rt@possion",
    title: "설계 회의, 2차",
    description: "링크: https://example.com; 준비물 없음",
    location: "3층 회의실",
    startsAt: utc(2026, 7, 27, 1, 30),
    endsAt: utc(2026, 7, 27, 2, 30),
    recurrence: "FREQ=WEEKLY;BYDAY=MO,WE",
  };
  const [back] = parseIcs(buildIcs([original]));
  assert.equal(back.uid, "rt@possion");
  assert.equal(back.title, original.title);
  assert.equal(back.description, original.description);
  assert.equal(back.location, original.location);
  assert.equal(back.startsAt.toISOString(), original.startsAt.toISOString());
  assert.equal(back.endsAt.toISOString(), original.endsAt.toISOString());
  assert.equal(back.allDay, false);
  assert.equal(back.recurrence, "FREQ=WEEKLY;BYDAY=MO,WE");
}

// 종일 일정 왕복 — 하루가 늘어나지 않아야 한다.
{
  const [back] = parseIcs(
    buildIcs([
      {
        uid: "ad@possion",
        title: "Offsite",
        startsAt: utc(2026, 7, 27),
        endsAt: utc(2026, 7, 29, 23, 59, 59),
        allDay: true,
      },
    ])
  );
  assert.equal(back.allDay, true);
  assert.equal(back.startsAt.getFullYear(), 2026);
  assert.equal(back.startsAt.getMonth(), 6);
  assert.equal(back.startsAt.getDate(), 27);
  // 내보낼 때 30일(배타적)로 적었고, 읽을 때 하루를 되돌려 29일이 된다.
  assert.equal(back.endsAt.getDate(), 29);
}

// ---------------------------------------------------------------- 가져오기
{
  // Google Calendar 가 실제로 내보내는 모양(접힌 줄, TZID, DURATION 혼용).
  const sample = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:abc123@google.com",
    "DTSTART;TZID=Asia/Seoul:20260727T140000",
    "DTEND;TZID=Asia/Seoul:20260727T150000",
    "SUMMARY:Long title that keeps going and going and going and going and g",
    " oing past the fold",
    "LOCATION:Somewhere\\, nice",
    "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=8",
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:dur@google.com",
    "DTSTART:20260801T000000Z",
    "DURATION:PT90M",
    "SUMMARY:With duration",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const events = parseIcs(sample);
  assert.equal(events.length, 2);
  assert.equal(
    events[0].title,
    "Long title that keeps going and going and going and going and going past the fold"
  );
  assert.equal(events[0].location, "Somewhere, nice");
  assert.equal(events[0].recurrence, "FREQ=WEEKLY;BYDAY=MO;COUNT=8");
  assert.equal(events[0].status, "confirmed");
  // TZID 는 해석하지 않고 "적힌 시각 그대로" 를 지킨다.
  assert.equal(events[0].startsAt.getHours(), 14);

  assert.equal(events[1].endsAt.getTime() - events[1].startsAt.getTime(), 90 * 60 * 1000);
}

// DTSTART 가 없는 VEVENT 는 버린다.
assert.equal(
  parseIcs("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:No start\r\nEND:VEVENT\r\nEND:VCALENDAR").length,
  0
);

// DTEND 가 없으면 1시간짜리로 본다.
{
  const [e] = parseIcs(
    "BEGIN:VEVENT\r\nDTSTART:20260727T090000Z\r\nSUMMARY:Open ended\r\nEND:VEVENT"
  );
  assert.equal(e.endsAt.getTime() - e.startsAt.getTime(), 60 * 60 * 1000);
}

// 끝이 시작보다 앞서면 시작으로 맞춘다.
{
  const [e] = parseIcs(
    "BEGIN:VEVENT\r\nDTSTART:20260727T090000Z\r\nDTEND:20260727T080000Z\r\nSUMMARY:Backwards\r\nEND:VEVENT"
  );
  assert.equal(e.endsAt.getTime(), e.startsAt.getTime());
}

// 빈 입력/쓰레기 입력에서 터지지 않는다.
assert.deepEqual(parseIcs(""), []);
assert.deepEqual(parseIcs("not a calendar at all"), []);

console.log("ics: all assertions passed");
