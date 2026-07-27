"use client";

import Link from "next/link";
import { useMemo } from "react";
import { expandOccurrences } from "@/lib/recurrence";

/**
 * 대시보드의 "다음 일정" 줄.
 *
 * 서버는 반복 규칙까지만 내려준다(전개하면 응답이 부풀고, 정확한 시각은 보는
 * 사람의 시간대에서 계산해야 한다). 여기서 앞으로 7일치만 펴서 가장 가까운
 * 네 개를 보여 준다. 일정이 하나도 없으면 아무것도 그리지 않는다 — 대시보드는
 * 한 화면에 들어가야 하고, 안 쓰는 기능이 그 높이를 먹으면 안 된다.
 */

export type UpcomingRow = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
  color: string | null;
  calendar_color: string;
  recurrence: string | null;
  recurrence_until: string | null;
  my_response: string | null;
};

export function UpcomingStrip({ rows }: { rows: UpcomingRow[] }) {
  const next = useMemo(() => {
    const now = new Date();
    const until = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const out: { key: string; row: UpcomingRow; start: Date }[] = [];
    for (const row of rows) {
      // 거절한 일정은 내 다음 일정이 아니다.
      if (row.my_response === "declined") continue;
      for (const occ of expandOccurrences(
        {
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          recurrence: row.recurrence,
          recurrenceUntil: row.recurrence_until,
          allDay: row.all_day,
        },
        now,
        until
      )) {
        out.push({ key: `${row.id}:${occ.start.getTime()}`, row, start: occ.start });
      }
    }
    return out.sort((a, b) => a.start.getTime() - b.start.getTime()).slice(0, 4);
  }, [rows]);

  if (next.length === 0) return null;

  return (
    <div className="dash-upnext">
      <span className="label cell-label">UP NEXT</span>
      <div className="dash-upnext-list">
        {next.map(({ key, row, start }) => (
          <Link
            key={key}
            href={`/calendar?event=${row.id}`}
            className="dash-upnext-item"
            style={{ borderLeftColor: row.color || row.calendar_color }}
          >
            <span className="dash-upnext-when">
              {row.all_day
                ? start.toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric" })
                : start.toLocaleString(undefined, {
                    weekday: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
            </span>
            <span className="dash-upnext-title">{row.title}</span>
            {row.my_response === "needs_action" && <span className="dash-upnext-rsvp">RSVP</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}
