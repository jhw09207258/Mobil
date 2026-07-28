"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/modal";
import { UserAvatar } from "@/components/user-avatar";
import { Copyable } from "@/components/copyable";
import { expandOccurrences } from "@/lib/recurrence";
import { useIsMobile } from "@/lib/use-media-query";
import {
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconMore,
  IconPlus,
  IconRefresh,
} from "../icons";
import {
  createCalendar,
  deleteCalendar,
  getFeedToken,
  importIcs,
  listCalendarMembers,
  listCalendars,
  listEvents,
  renameCalendar,
  shareCalendar,
  unshareCalendar,
  type CalendarEventRow,
  type CalendarMember,
  type CalendarSummary,
} from "./actions";
import { EventDialog, type Contact, type DraftSeed } from "./event-dialog";
import {
  addDays,
  allDayKey,
  dayKey,
  formatTime,
  rangeTitle,
  sameDay,
  shiftAnchor,
  startOfDay,
  startOfMonthGrid,
  startOfWeek,
  visibleRange,
  WEEKDAYS,
  type ViewMode,
} from "./date-utils";
import "./calendar.css";

/** 시간 격자에서 한 시간의 높이(px). 여기 하나만 바꾸면 전체가 따라간다. */
const HOUR_PX = 48;
const CALENDAR_COLORS = [
  "#3b82f6", "#8b5cf6", "#ec4899", "#ef4444",
  "#f59e0b", "#10b981", "#14b8a6", "#6b7280",
];

/** 한 번 펴진 발생 — 화면이 다루는 최소 단위. */
type Occurrence = {
  key: string;
  event: CalendarEventRow;
  start: Date;
  end: Date;
};

export function CalendarShell({
  selfId,
  initialCalendars,
  contacts,
}: {
  selfId: string;
  initialCalendars: CalendarSummary[];
  contacts: Contact[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();

  const [calendars, setCalendars] = useState(initialCalendars);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [view, setView] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [rows, setRows] = useState<CalendarEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: "new"; seed: DraftSeed }
    | { kind: "existing"; eventId: string; occurrenceStart?: string }
    | null
  >(null);
  const [calendarDialog, setCalendarDialog] = useState<CalendarSummary | "new" | null>(null);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // 이미 알린 발생 — 같은 알림이 매 틱 반복되지 않게 한다.
  const notified = useRef<Set<string>>(new Set());
  // 이 브라우저가 웹 푸시를 구독 중인가. 그렇다면 화면 안 배너는 띄우지 않는다.
  const [pushActive, setPushActive] = useState(false);

  const range = useMemo(() => visibleRange(anchor, view), [anchor, view]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // 반복 일정을 놓치지 않도록 범위를 넉넉히 잡아 요청하고, 정확한 발생은
      // 화면에서 다시 잘라낸다.
      const from = addDays(range.from, -1).toISOString();
      const to = addDays(range.to, 1).toISOString();
      setRows(await listEvents(from, to));
      setError(null);
    } catch {
      setError("Could not load events.");
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    reload();
  }, [reload]);

  const refreshCalendars = useCallback(() => {
    listCalendars().then(setCalendars, () => {});
  }, []);

  // 채팅의 일정 칩(/calendar?event=…)으로 들어오면 그 일정을 바로 연다.
  useEffect(() => {
    const wanted = searchParams.get("event");
    if (wanted) setDialog({ kind: "existing", eventId: wanted });
  }, [searchParams]);

  // ---- 실시간 ----
  // 보이는 달력마다 채널을 연다. 누가 고치면 다시 읽는다 — 증분 병합은 반복
  // 일정 때문에 오히려 틀리기 쉽다(규칙 하나가 화면의 발생 여러 개를 바꾼다).
  useEffect(() => {
    const supabase = createClient();
    const channels: RealtimeChannel[] = [];
    for (const c of calendars) {
      const channel = supabase.channel(`calendar:${c.id}`, {
        config: { broadcast: { self: false, ack: false }, private: true },
      });
      channel.on("broadcast", { event: "changed" }, () => reload()).subscribe();
      channels.push(channel);
    }
    return () => {
      for (const ch of channels) supabase.removeChannel(ch);
    };
  }, [calendars, reload]);

  const announceChange = useCallback((calendarId: string) => {
    const supabase = createClient();
    const channel = supabase.channel(`calendar:${calendarId}`, {
      config: { broadcast: { self: false, ack: false }, private: true },
    });
    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      channel
        .send({ type: "broadcast", event: "changed", payload: {} })
        .finally(() => supabase.removeChannel(channel));
    });
  }, []);

  // ---- 발생 전개 ----
  const occurrences = useMemo(() => {
    const out: Occurrence[] = [];
    for (const row of rows) {
      if (hidden.has(row.calendar_id)) continue;
      for (const occ of expandOccurrences(
        {
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          recurrence: row.recurrence,
          recurrenceUntil: row.recurrence_until,
          allDay: row.all_day,
          // 반복은 만든 사람의 시간대로 전개한다 — 시차·서머타임에서 요일이
          // 어긋나지 않게. "이 일정만 삭제" 로 빠진 발생도 여기서 걸러진다.
          timeZone: row.time_zone,
          exceptions: row.exceptions,
        },
        range.from,
        range.to
      )) {
        out.push({
          key: `${row.id}:${occ.start.getTime()}`,
          event: row,
          start: occ.start,
          end: occ.end,
        });
      }
    }
    return out.sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [rows, hidden, range.from, range.to]);

  /** 날짜 칸 → 그 날의 발생들. 종일은 UTC 날짜로 담는다. */
  const byDay = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    const push = (key: string, occ: Occurrence) => {
      const list = map.get(key);
      if (list) list.push(occ);
      else map.set(key, [occ]);
    };
    for (const occ of occurrences) {
      if (occ.event.all_day) {
        // 여러 날에 걸친 종일 일정은 걸치는 날마다 담는다(최대 60일까지).
        let cursor = new Date(occ.start.getTime());
        for (let i = 0; i < 60; i += 1) {
          push(allDayKey(cursor), occ);
          const next = new Date(cursor.getTime());
          next.setUTCDate(next.getUTCDate() + 1);
          if (next.getTime() > occ.end.getTime()) break;
          cursor = next;
        }
      } else {
        let cursor = startOfDay(occ.start);
        for (let i = 0; i < 60; i += 1) {
          push(dayKey(cursor), occ);
          const next = addDays(cursor, 1);
          if (next.getTime() > occ.end.getTime()) break;
          cursor = next;
        }
      }
    }
    return map;
  }, [occurrences]);

  const dayOccurrences = useCallback(
    (day: Date) => [
      ...(byDay.get(allDayKey(new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate())))) ?? [])
        .filter((o) => o.event.all_day),
      ...(byDay.get(dayKey(day)) ?? []).filter((o) => !o.event.all_day),
    ],
    [byDay]
  );

  // ---- 알림 ----
  // 화면 안 배너 알림. 이 브라우저가 웹 푸시를 구독하고 있으면 **끈다** —
  // 같은 일정으로 OS 알림과 배너가 동시에 뜨면 사람들은 알림을 통째로 꺼 버린다.
  // 푸시를 안 켠 사람에게는 이것이 유일한 알림이므로 남겨 둔다.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => {
        if (!cancelled) setPushActive(!!sub);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (pushActive) return;
    const tick = () => {
      const now = Date.now();
      for (const occ of occurrences) {
        const lead = occ.event.reminder_minutes;
        if (lead === null || lead === undefined) continue;
        if (occ.event.status === "cancelled") continue;
        if (occ.event.my_response === "declined") continue;
        const fireAt = occ.start.getTime() - lead * 60_000;
        // 지나간 지 5분이 넘은 알림은 되살리지 않는다.
        if (now < fireAt || now - fireAt > 5 * 60_000) continue;
        if (notified.current.has(occ.key)) continue;
        notified.current.add(occ.key);
        setNotice(
          lead === 0
            ? `“${occ.event.title}” is starting now.`
            : `“${occ.event.title}” starts at ${formatTime(occ.start)}.`
        );
      }
    };
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, [occurrences, pushActive]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  const toggleCalendar = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openNewAt = (start: Date, allDay: boolean) => {
    const writable = calendars.find((c) => c.my_role !== "viewer");
    if (!writable) {
      setError("You don't have a calendar you can add events to.");
      return;
    }
    const end = allDay ? start : new Date(start.getTime() + 60 * 60 * 1000);
    setDialog({
      kind: "new",
      seed: {
        start: allDay ? new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) : start,
        end: allDay ? new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) : end,
        allDay,
        calendarId: writable.id,
      },
    });
  };

  const onSaved = () => {
    const target = dialog?.kind === "existing" ? rows.find((r) => r.id === dialog.eventId) : null;
    setDialog(null);
    // 쿼리로 열려 있었다면 주소도 정리한다 — 새로고침에서 다시 열리지 않게.
    if (searchParams.get("event")) router.replace("/calendar");
    reload();
    refreshCalendars();
    for (const c of calendars) {
      if (c.my_role === "viewer") continue;
      if (!target || target.calendar_id === c.id) announceChange(c.id);
    }
  };

  const closeDialog = () => {
    setDialog(null);
    if (searchParams.get("event")) router.replace("/calendar");
  };

  const eventColor = (occ: Occurrence) => occ.event.color || occ.event.calendar_color;

  // -------------------------------------------------------------- 렌더
  return (
    <div className="content cal-page">
      <div className="cal-topbar">
        <div className="row" style={{ gap: 6, minWidth: 0 }}>
          {isMobile && (
            <button
              className="btn btn-sm"
              onClick={() => setSidebarOpen(true)}
              aria-label="Calendars"
            >
              Calendars
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setAnchor(new Date())}>
            Today
          </button>
          <button
            className="btn btn-sm"
            onClick={() => setAnchor((a) => shiftAnchor(a, view, -1))}
            aria-label="Previous"
          >
            <IconChevronLeft size={13} />
          </button>
          <button
            className="btn btn-sm"
            onClick={() => setAnchor((a) => shiftAnchor(a, view, 1))}
            aria-label="Next"
          >
            <IconChevronRight size={13} />
          </button>
          <h1 className="cal-title">{rangeTitle(anchor, view)}</h1>
          {loading && <span className="muted" style={{ fontSize: 11 }}>Loading…</span>}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <div className="cal-views">
            {(["month", "week", "day", "agenda"] as ViewMode[]).map((v) => (
              <button
                key={v}
                className={`category-tab ${view === v ? "active" : ""}`}
                onClick={() => setView(v)}
              >
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => openNewAt(defaultStart(anchor), false)}
          >
            <IconPlus size={13} /> New event
          </button>
        </div>
      </div>

      {error && <div className="notice notice-error">{error}</div>}
      {notice && (
        <div className="notice notice-info cal-notice">
          <span>{notice}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setNotice(null)} aria-label="Dismiss">
            <IconClose size={11} />
          </button>
        </div>
      )}

      <div className="cal-body">
        {/* ---------------------------------------------- 달력 목록 */}
        <aside className={`cal-side ${sidebarOpen ? "open" : ""}`}>
          {isMobile && sidebarOpen && (
            <button className="btn btn-sm btn-block" onClick={() => setSidebarOpen(false)}>
              Close
            </button>
          )}
          <div className="cal-side-head">
            <span className="label">MY CALENDARS</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setCalendarDialog("new")}
              title="New calendar"
              aria-label="New calendar"
            >
              <IconPlus size={13} />
            </button>
          </div>
          {calendars.map((c) => (
            <div key={c.id} className="cal-side-row">
              <label className="cal-side-check">
                <input
                  type="checkbox"
                  checked={!hidden.has(c.id)}
                  onChange={() => toggleCalendar(c.id)}
                  aria-label={`Show ${c.name}`}
                />
                <span className="cal-dot" style={{ background: c.color }} />
                <span className="cal-side-name" title={c.name}>{c.name}</span>
              </label>
              <span className="cal-side-role">
                {c.my_role === "owner" ? "" : c.my_role === "editor" ? "edit" : "view"}
              </span>
              {c.my_role === "owner" && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setCalendarDialog(c)}
                  aria-label={`Manage ${c.name}`}
                  title="Manage & share"
                >
                  <IconMore size={14} />
                </button>
              )}
            </div>
          ))}

          <div className="cal-side-sep" />
          <button className="btn btn-sm btn-block" onClick={() => setSubscribeOpen(true)}>
            Subscribe &amp; import
          </button>
          <p className="cal-side-hint">
            Put Possion events in Google or Apple Calendar, or bring an .ics file in.
          </p>
        </aside>

        {/* ---------------------------------------------- 본문 */}
        <div className="cal-main">
          {view === "month" && (
            <MonthView
              maxPills={isMobile ? 2 : 3}
              anchor={anchor}
              dayOccurrences={dayOccurrences}
              eventColor={eventColor}
              onPickDay={(d) => openNewAt(d, true)}
              onOpen={(occ) => setDialog({ kind: "existing", eventId: occ.event.id, occurrenceStart: occ.start.toISOString() })}
              onExpandDay={(d) => {
                setAnchor(d);
                setView("day");
              }}
            />
          )}
          {(view === "week" || view === "day") && (
            <TimeGridView
              days={
                view === "week"
                  ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i))
                  : [startOfDay(anchor)]
              }
              dayOccurrences={dayOccurrences}
              eventColor={eventColor}
              onPickSlot={(d) => openNewAt(d, false)}
              onPickAllDay={(d) => openNewAt(d, true)}
              onOpen={(occ) => setDialog({ kind: "existing", eventId: occ.event.id, occurrenceStart: occ.start.toISOString() })}
            />
          )}
          {view === "agenda" && (
            <AgendaView
              from={range.from}
              occurrences={occurrences}
              eventColor={eventColor}
              onOpen={(occ) => setDialog({ kind: "existing", eventId: occ.event.id, occurrenceStart: occ.start.toISOString() })}
            />
          )}
        </div>
      </div>

      {dialog && (
        <EventDialog
          mode={dialog}
          calendars={calendars}
          contacts={contacts}
          selfId={selfId}
          onClose={closeDialog}
          onSaved={onSaved}
        />
      )}

      {calendarDialog && (
        <CalendarDialog
          target={calendarDialog}
          contacts={contacts}
          onClose={() => setCalendarDialog(null)}
          onChanged={() => {
            setCalendarDialog(null);
            refreshCalendars();
            reload();
          }}
        />
      )}

      {subscribeOpen && (
        <SubscribeDialog
          calendars={calendars}
          onClose={() => setSubscribeOpen(false)}
          onImported={(msg) => {
            setSubscribeOpen(false);
            setNotice(msg);
            reload();
            refreshCalendars();
          }}
        />
      )}
    </div>
  );
}

/** "새 일정" 버튼의 기본 시각 — 오늘이면 다음 정시, 아니면 그 날 09:00. */
function defaultStart(anchor: Date): Date {
  const now = new Date();
  if (sameDay(anchor, now)) {
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next;
  }
  return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 9, 0, 0, 0);
}

// ---------------------------------------------------------------------------
// 월 보기
// ---------------------------------------------------------------------------
function MonthView({
  anchor,
  dayOccurrences,
  eventColor,
  onPickDay,
  onOpen,
  onExpandDay,
  maxPills,
}: {
  anchor: Date;
  dayOccurrences: (d: Date) => Occurrence[];
  eventColor: (o: Occurrence) => string;
  onPickDay: (d: Date) => void;
  onOpen: (o: Occurrence) => void;
  onExpandDay: (d: Date) => void;
  /** 한 칸에 보여 줄 일정 개수 — 좁은 화면에서는 칸이 낮아 더 적게 넣는다. */
  maxPills: number;
}) {
  const gridStart = startOfMonthGrid(anchor);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = new Date();

  return (
    <div className="cal-month">
      <div className="cal-month-head">
        {WEEKDAYS.map((w) => (
          <div key={w} className="cal-month-weekday">{w}</div>
        ))}
      </div>
      <div className="cal-month-grid">
        {days.map((day) => {
          const list = dayOccurrences(day);
          const outside = day.getMonth() !== anchor.getMonth();
          const shown = list.slice(0, maxPills);
          return (
            <div
              key={dayKey(day)}
              className={`cal-cell ${outside ? "outside" : ""} ${sameDay(day, today) ? "today" : ""}`}
              onDoubleClick={() => onPickDay(day)}
            >
              <div className="cal-cell-head">
                <button
                  className="cal-cell-day"
                  onClick={() => onExpandDay(day)}
                  title="Open this day"
                >
                  {day.getDate()}
                </button>
                <button
                  className="cal-cell-add"
                  onClick={() => onPickDay(day)}
                  aria-label={`Add an event on ${day.toDateString()}`}
                  title="Add an event"
                >
                  <IconPlus size={12} />
                </button>
              </div>
              {shown.map((occ) => (
                <button
                  key={occ.key}
                  className={`cal-pill ${occ.event.status === "cancelled" ? "cancelled" : ""}`}
                  style={{ borderLeftColor: eventColor(occ) }}
                  onClick={() => onOpen(occ)}
                  title={occ.event.title}
                >
                  {!occ.event.all_day && (
                    <span className="cal-pill-time">{formatTime(occ.start)}</span>
                  )}
                  <span className="cal-pill-title">{occ.event.title}</span>
                </button>
              ))}
              {list.length > shown.length && (
                <button className="cal-more" onClick={() => onExpandDay(day)}>
                  +{list.length - shown.length} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 주 / 일 보기 — 시간 격자
// ---------------------------------------------------------------------------
function TimeGridView({
  days,
  dayOccurrences,
  eventColor,
  onPickSlot,
  onPickAllDay,
  onOpen,
}: {
  days: Date[];
  dayOccurrences: (d: Date) => Occurrence[];
  eventColor: (o: Occurrence) => string;
  onPickSlot: (d: Date) => void;
  onPickAllDay: (d: Date) => void;
  onOpen: (o: Occurrence) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = new Date();

  // 하루 24시간을 다 보여주면 실제 일과가 화면 밖에 있다 — 오전 7시로 맞춰 연다.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_PX;
  }, []);

  return (
    // 열 개수와 "이 격자가 필요로 하는 최소 폭" 은 CSS 가 알 수 없다(주=7,
    // 일=1). 좁은 화면에서 한 열이 최소 84px 은 되도록 최소 폭을 함께 넘기고,
    // CSS 는 그 값으로 가로 스크롤 여부를 스스로 정한다.
    <div
      className="cal-timegrid"
      style={{
        ["--cal-days" as string]: days.length,
        ["--cal-min-width" as string]: `calc(var(--cal-gutter, 58px) + ${days.length} * 84px)`,
      }}
    >
      <div className="cal-tg-head">
        <div className="cal-tg-gutter" />
        {days.map((d) => (
          <div key={dayKey(d)} className={`cal-tg-day ${sameDay(d, today) ? "today" : ""}`}>
            <span className="cal-tg-weekday">{WEEKDAYS[d.getDay()]}</span>
            <span className="cal-tg-date">{d.getDate()}</span>
          </div>
        ))}
      </div>

      {/* 종일 줄 — 시간 격자 안에 두면 위치를 정할 수 없다. */}
      <div className="cal-tg-allday">
        <div className="cal-tg-gutter label">ALL DAY</div>
        {days.map((d) => {
          const list = dayOccurrences(d).filter((o) => o.event.all_day);
          return (
            <div
              key={dayKey(d)}
              className="cal-tg-allday-cell"
              onDoubleClick={() => onPickAllDay(d)}
            >
              {list.map((occ) => (
                <button
                  key={occ.key}
                  className="cal-pill"
                  style={{ borderLeftColor: eventColor(occ) }}
                  onClick={() => onOpen(occ)}
                >
                  <span className="cal-pill-title">{occ.event.title}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>

      <div className="cal-tg-scroll" ref={scrollRef}>
        <div className="cal-tg-body" style={{ height: 24 * HOUR_PX }}>
          <div className="cal-tg-gutter cal-tg-hours">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="cal-tg-hour" style={{ height: HOUR_PX }}>
                <span>{h === 0 ? "" : `${h}:00`}</span>
              </div>
            ))}
          </div>
          {days.map((d) => {
            const list = dayOccurrences(d).filter((o) => !o.event.all_day);
            const laid = layout(list, d);
            return (
              <div
                key={dayKey(d)}
                className={`cal-tg-col ${sameDay(d, today) ? "today" : ""}`}
                onDoubleClick={(e) => {
                  const box = e.currentTarget.getBoundingClientRect();
                  const minutes = Math.floor(((e.clientY - box.top) / HOUR_PX) * 60 / 15) * 15;
                  const at = new Date(d.getFullYear(), d.getMonth(), d.getDate());
                  at.setMinutes(Math.max(0, Math.min(minutes, 23 * 60 + 45)));
                  onPickSlot(at);
                }}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="cal-tg-line" style={{ top: h * HOUR_PX }} />
                ))}
                {laid.map(({ occ, top, height, left, width }) => (
                  <button
                    key={occ.key}
                    className={`cal-block ${occ.event.status === "cancelled" ? "cancelled" : ""}`}
                    style={{
                      top,
                      height,
                      left: `${left}%`,
                      width: `${width}%`,
                      borderLeftColor: eventColor(occ),
                      background: `color-mix(in srgb, ${eventColor(occ)} 18%, var(--bg-2))`,
                    }}
                    onClick={() => onOpen(occ)}
                    title={`${occ.event.title} · ${formatTime(occ.start)}`}
                  >
                    <span className="cal-block-title">{occ.event.title}</span>
                    <span className="cal-block-time">{formatTime(occ.start)}</span>
                  </button>
                ))}
                {sameDay(d, today) && <NowLine />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 겹치는 일정을 나란히 놓는다 — 겹침 묶음 안에서 폭을 n 등분한다. */
function layout(
  list: Occurrence[],
  day: Date
): { occ: Occurrence; top: number; height: number; left: number; width: number }[] {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;

  const boxes = list
    .map((occ) => {
      // 자정을 넘는 일정은 이 날의 범위로 잘라 그린다.
      const from = Math.max(occ.start.getTime(), dayStart);
      const to = Math.min(occ.end.getTime(), dayEnd);
      const top = ((from - dayStart) / 3_600_000) * HOUR_PX;
      // 아주 짧은 일정도 눌러야 하므로 최소 높이를 준다.
      const height = Math.max(((to - from) / 3_600_000) * HOUR_PX, 18);
      return { occ, top, height, from, to };
    })
    .sort((a, b) => a.from - b.from || b.to - a.to);

  const out: { occ: Occurrence; top: number; height: number; left: number; width: number }[] = [];
  let cluster: typeof boxes = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    // 묶음 안에서 열을 배정한다 — 앞 열의 마지막이 끝난 뒤면 그 열을 재사용.
    const columnEnds: number[] = [];
    const assigned = cluster.map((b) => {
      let col = columnEnds.findIndex((end) => end <= b.from);
      if (col === -1) {
        col = columnEnds.length;
        columnEnds.push(b.to);
      } else {
        columnEnds[col] = b.to;
      }
      return { ...b, col };
    });
    const cols = columnEnds.length;
    for (const b of assigned) {
      out.push({
        occ: b.occ,
        top: b.top,
        height: b.height,
        left: (b.col / cols) * 100,
        width: (1 / cols) * 100,
      });
    }
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const b of boxes) {
    if (cluster.length > 0 && b.from >= clusterEnd) flush();
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.to);
  }
  flush();

  return out;
}

/** 지금 시각 선 — 1분마다 움직인다. */
function NowLine() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const top = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX;
  return <div className="cal-now" style={{ top }} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// 아젠다 — 목록으로 보는 앞으로 30일
// ---------------------------------------------------------------------------
function AgendaView({
  from,
  occurrences,
  eventColor,
  onOpen,
}: {
  from: Date;
  occurrences: Occurrence[];
  eventColor: (o: Occurrence) => string;
  onOpen: (o: Occurrence) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const occ of occurrences) {
      if (occ.end.getTime() < from.getTime()) continue;
      const key = occ.event.all_day ? allDayKey(occ.start) : dayKey(occ.start);
      const list = map.get(key);
      if (list) list.push(occ);
      else map.set(key, [occ]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [occurrences, from]);

  if (groups.length === 0) {
    return <div className="empty">Nothing scheduled in the next 30 days.</div>;
  }

  return (
    <div className="cal-agenda">
      {groups.map(([key, list]) => (
        <div key={key} className="cal-agenda-day">
          <div className="cal-agenda-date">
            {new Date(`${key}T00:00:00`).toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </div>
          {list.map((occ) => (
            <div key={occ.key} className="cal-agenda-item">
              <button className="cal-agenda-row" onClick={() => onOpen(occ)}>
                <span className="cal-dot" style={{ background: eventColor(occ) }} />
                <span className="cal-agenda-when">
                  {occ.event.all_day ? "All day" : formatTime(occ.start)}
                </span>
                <span className="cal-agenda-title">{occ.event.title}</span>
                <span className="cal-agenda-meta">
                  {[
                    occ.event.location,
                    occ.event.attendee_count > 1 ? `${occ.event.attendee_count} guests` : null,
                    occ.event.link_count > 0 ? `${occ.event.link_count} attached` : null,
                    occ.event.my_response === "needs_action" && occ.event.is_invited ? "Needs reply" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
              {/* 회의 직전에 목록에서 바로 들어갈 수 있어야 한다 — 일정을 열고
                  링크를 찾는 단계가 있으면 아무도 안 쓴다. */}
              {occ.event.conference_url && /^https?:\/\//i.test(occ.event.conference_url) && (
                <a
                  className="btn btn-sm cal-agenda-join"
                  href={occ.event.conference_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  Join
                </a>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 달력 만들기 / 이름·색 바꾸기 / 공유
// ---------------------------------------------------------------------------
function CalendarDialog({
  target,
  contacts,
  onClose,
  onChanged,
}: {
  target: CalendarSummary | "new";
  contacts: Contact[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const isNew = target === "new";
  const cal = isNew ? null : target;
  const [name, setName] = useState(cal?.name ?? "");
  const [color, setColor] = useState(cal?.color ?? CALENDAR_COLORS[0]);
  const [members, setMembers] = useState<CalendarMember[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cal) return;
    listCalendarMembers(cal.id).then(setMembers, () => setMembers([]));
  }, [cal]);

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = isNew ? await createCalendar(name, color) : await renameCalendar(cal!.id, name, color);
    setBusy(false);
    if ("error" in res) setError(res.error);
    else onChanged();
  };

  const remove = async () => {
    if (!cal) return;
    if (!confirm(`Delete “${cal.name}”? Its ${cal.event_count} event(s) go with it.`)) return;
    setBusy(true);
    const res = await deleteCalendar(cal.id);
    setBusy(false);
    if ("error" in res) setError(res.error);
    else onChanged();
  };

  const share = async (userId: string, role: "viewer" | "editor") => {
    if (!cal) return;
    const res = await shareCalendar(cal.id, userId, role);
    if ("error" in res) setError(res.error);
    else listCalendarMembers(cal.id).then(setMembers, () => {});
  };

  const unshare = async (userId: string) => {
    if (!cal) return;
    const res = await unshareCalendar(cal.id, userId);
    if ("error" in res) setError(res.error);
    else setMembers((prev) => (prev ?? []).filter((m) => m.user_id !== userId));
  };

  const memberIds = new Set((members ?? []).map((m) => m.user_id));

  return (
    <Modal title={isNew ? "New calendar" : "Calendar settings"} onClose={onClose} width={480}>
      {error && <div className="notice notice-error">{error}</div>}

      <div className="field">
        <label className="label" htmlFor="cal-name">NAME</label>
        <input
          id="cal-name"
          className="input"
          value={name}
          maxLength={80}
          placeholder="Team calendar"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="field">
        <label className="label">COLOUR</label>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {CALENDAR_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`cal-color ${color === c ? "on" : ""}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              aria-label={`Colour ${c}`}
            />
          ))}
        </div>
      </div>

      {!isNew && (
        <div className="field">
          <label className="label">SHARED WITH ({members?.length ?? 0})</label>
          <div className="cal-members">
            {members === null && <div className="empty">Loading…</div>}
            {members?.length === 0 && (
              <span className="muted" style={{ fontSize: 12 }}>
                Not shared yet — pick someone below.
              </span>
            )}
            {members?.map((m) => (
              <div key={m.user_id} className="cal-member">
                <UserAvatar url={m.avatar_url} name={m.name} size={24} />
                <span className="cal-member-name">{m.name}</span>
                <select
                  className="select"
                  style={{ width: 96, height: 26 }}
                  value={m.role}
                  onChange={(e) => share(m.user_id, e.target.value as "viewer" | "editor")}
                  aria-label={`Role for ${m.name}`}
                >
                  <option value="viewer">Can view</option>
                  <option value="editor">Can edit</option>
                </select>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => unshare(m.user_id)}
                  aria-label={`Remove ${m.name}`}
                >
                  <IconClose size={11} />
                </button>
              </div>
            ))}
          </div>

          <div className="cal-members" style={{ marginTop: 10 }}>
            {contacts
              .filter((c) => !memberIds.has(c.id))
              .map((c) => (
                <button
                  key={c.id}
                  className="cal-member cal-member-add"
                  onClick={() => share(c.id, "viewer")}
                >
                  <UserAvatar url={c.avatar_url} name={c.name} size={24} />
                  <span className="cal-member-name">{c.name}</span>
                  <span className="cal-send">Share</span>
                </button>
              ))}
          </div>
        </div>
      )}

      <div className="cal-dialog-actions">
        {!isNew && !cal?.is_default && (
          <button className="btn btn-sm btn-danger" onClick={remove} disabled={busy}>
            Delete calendar
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={save} disabled={busy || !name.trim()}>
          {busy ? "Saving…" : isNew ? "Create" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// 외부 캘린더 — 구독 주소 발급 / .ics 가져오기
// ---------------------------------------------------------------------------
function SubscribeDialog({
  calendars,
  onClose,
  onImported,
}: {
  calendars: CalendarSummary[];
  onClose: () => void;
  onImported: (message: string) => void;
}) {
  const writable = calendars.filter((c) => c.my_role !== "viewer");
  const [feedUrl, setFeedUrl] = useState<string | null>(null);
  const [target, setTarget] = useState(writable[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadToken = useCallback(async (rotate: boolean) => {
    setBusy(true);
    setError(null);
    const res = await getFeedToken(rotate);
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setFeedUrl(`${window.location.origin}/api/calendar/feed?token=${res.token}`);
  }, []);

  useEffect(() => {
    loadToken(false);
  }, [loadToken]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!target) {
      setError("Pick a calendar to import into.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("That .ics file is too large (max 5MB).");
      return;
    }
    setBusy(true);
    setError(null);
    const text = await file.text();
    const res = await importIcs(target, text);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if ("error" in res) {
      setError(res.error);
      return;
    }
    onImported(
      `Imported ${res.imported} event${res.imported === 1 ? "" : "s"}` +
        (res.skipped > 0 ? ` — ${res.skipped} could not be read` : "") +
        (res.truncated > 0
          ? ` — ${res.truncated} left out (max ${res.imported + res.skipped} per import; run it again for the rest)`
          : "") +
        "."
    );
  };

  return (
    <Modal title="Subscribe & import" onClose={onClose} width={560}>
      {error && <div className="notice notice-error">{error}</div>}

      <div className="field">
        <label className="label">SUBSCRIPTION LINK</label>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 8 }}>
          Add this URL in Google Calendar (<em>Other calendars → From URL</em>) or Apple
          Calendar (<em>File → New Calendar Subscription</em>) to see Possion events there.
          It is read-only and refreshes about once an hour.
        </p>
        {feedUrl ? (
          <Copyable value={feedUrl} label="Calendar feed URL" />
        ) : (
          <div className="empty">{busy ? "Creating…" : "—"}</div>
        )}
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <button className="btn btn-sm" disabled={busy} onClick={() => loadToken(true)}>
            <IconRefresh size={13} /> Reset link
          </button>
          <span className="muted" style={{ fontSize: 11 }}>
            Resetting stops any calendar app already using the old link.
          </span>
        </div>
      </div>

      <div className="cal-side-sep" />

      <div className="field">
        <label className="label" htmlFor="cal-import-target">IMPORT AN .ICS FILE</label>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 8 }}>
          Export from Google/Apple/Outlook and drop the file here. Titles, times, places,
          notes and repeat rules come across; guests and attachments do not.
        </p>
        <select
          id="cal-import-target"
          className="select"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          style={{ marginBottom: 8 }}
        >
          {writable.length === 0 && <option value="">No writable calendar</option>}
          {writable.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input
          ref={fileRef}
          type="file"
          accept=".ics,text/calendar"
          className="input"
          disabled={busy || !target}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </div>
    </Modal>
  );
}
