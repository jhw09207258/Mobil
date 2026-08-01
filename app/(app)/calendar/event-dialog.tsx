"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/modal";
import { UserAvatar } from "@/components/user-avatar";
import { describeRecurrence, formatRecurrence, parseRecurrence, DAY_LABELS, type Freq } from "@/lib/recurrence";
import {
  getObjectCards,
  listAttachables,
  type AttachableObject,
  type ObjectCard,
  type ObjectKind,
} from "../sharing/actions";
import { OpenItemButton } from "../workspace/open-item-button";
import { SendToChatButton } from "../send-to-chat-button";
import { Tooltip } from "@/components/ui/tooltip";
import { IconClose } from "../icons";
import {
  deleteEvent,
  deleteOccurrence,
  detachOccurrence,
  getEvent,
  linkEventObject,
  respondToEvent,
  saveEvent,
  unlinkEventObject,
  type CalendarSummary,
  type EventDetail,
  type OccurrenceScope,
} from "./actions";
import { fromDateInputUtc, toDateInputLocal, toDateInputUtc, toLocalInput } from "./date-utils";

export type Contact = { id: string; name: string; email: string; avatar_url: string | null };

/** 새 일정을 열 때의 초기값(빈 칸 클릭). */
export type DraftSeed = { start: Date; end: Date; allDay: boolean; calendarId?: string };

type Mode =
  | { kind: "new"; seed: DraftSeed }
  /** occurrenceStart 가 있으면 "그 발생을 눌러서 연 것" — 반복 일정에서
   *  "이 일정만" 을 고를 수 있다. */
  | { kind: "existing"; eventId: string; occurrenceStart?: string };

const REMINDER_CHOICES: { value: number | null; label: string }[] = [
  { value: null, label: "No reminder" },
  { value: 0, label: "At start time" },
  { value: 5, label: "5 minutes before" },
  { value: 10, label: "10 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 1440, label: "1 day before" },
];

const KIND_LABEL: Record<string, string> = {
  document: "Doc",
  code: "Code",
  sheet: "Table",
  mindmap: "Link Graph",
  file: "File",
  event: "Event",
};

// 이벤트 색 프리셋 — 캘린더 생성창의 CALENDAR_COLORS(calendar-shell.tsx)와
// 같은 팔레트에 의미(태그)를 붙인 것. null(첫 항목)이면 색을 지정하지 않고
// 캘린더 자체 색을 그대로 물려받는다(색이 nullable 인 이유가 이것).
const EVENT_COLOR_PRESETS: { value: string | null; label: string }[] = [
  { value: null, label: "Calendar default" },
  { value: "#3b82f6", label: "Work" },
  { value: "#8b5cf6", label: "Meeting" },
  { value: "#ef4444", label: "Urgent" },
  { value: "#f59e0b", label: "Deadline" },
  { value: "#10b981", label: "Personal" },
  { value: "#14b8a6", label: "Travel" },
  { value: "#ec4899", label: "Social" },
  { value: "#6b7280", label: "Other" },
];

export function EventDialog({
  mode,
  calendars,
  contacts,
  selfId,
  onClose,
  onSaved,
}: {
  mode: Mode;
  calendars: CalendarSummary[];
  contacts: Contact[];
  selfId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const writable = useMemo(
    () => calendars.filter((c) => c.my_role === "owner" || c.my_role === "editor"),
    [calendars]
  );

  const [loading, setLoading] = useState(mode.kind === "existing");
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- 폼 상태 ----
  const [calendarId, setCalendarId] = useState(
    mode.kind === "new" ? (mode.seed.calendarId ?? writable[0]?.id ?? "") : ""
  );
  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(mode.kind === "new" ? mode.seed.allDay : false);
  const [startInput, setStartInput] = useState(
    mode.kind === "new"
      ? mode.seed.allDay
        ? toDateInputUtc(mode.seed.start)
        : toLocalInput(mode.seed.start)
      : ""
  );
  const [endInput, setEndInput] = useState(
    mode.kind === "new"
      ? mode.seed.allDay
        ? toDateInputUtc(mode.seed.end)
        : toLocalInput(mode.seed.end)
      : ""
  );
  const [color, setColor] = useState<string | null>(null);
  const [location, setLocation] = useState("");
  const [conferenceUrl, setConferenceUrl] = useState("");
  const [description, setDescription] = useState("");
  const [reminder, setReminder] = useState<number | null>(10);
  const [status, setStatus] = useState<"confirmed" | "tentative" | "cancelled">("confirmed");
  const [busyFlag, setBusyFlag] = useState(true);
  const [attendees, setAttendees] = useState<Set<string>>(new Set());

  // 반복 — RRULE 문자열을 직접 다루게 하지 않는다.
  const [repeatFreq, setRepeatFreq] = useState<"none" | Freq>("none");
  const [repeatInterval, setRepeatInterval] = useState(1);
  const [repeatDays, setRepeatDays] = useState<Set<number>>(new Set());
  const [repeatUntil, setRepeatUntil] = useState("");

  // 붙어 있는 자료. id 만으로는 사용자가 무엇인지 알 수 없으므로 제목까지
  // 받아 온다 — "회의 전에 읽을 것을 그 자리에 둔다" 가 이 기능의 목적인데,
  // 무엇인지 못 읽으면 목적을 이루지 못한다.
  const [links, setLinks] = useState<{ kind: string; id: string }[]>([]);
  const [linkCards, setLinkCards] = useState<Map<string, ObjectCard>>(() => new Map());
  const [linkPicker, setLinkPicker] = useState(false);
  const [attachables, setAttachables] = useState<AttachableObject[] | null>(null);
  const [attachQuery, setAttachQuery] = useState("");

  const editable = mode.kind === "new" || !!detail?.can_edit;

  // ---- 기존 일정 불러오기 ----
  useEffect(() => {
    if (mode.kind !== "existing") return;
    let cancelled = false;
    getEvent(mode.eventId).then(
      (d) => {
        if (cancelled) return;
        setLoading(false);
        if (!d) {
          setError("This event is no longer available.");
          return;
        }
        setDetail(d);
        setCalendarId(d.calendar_id);
        setTitle(d.title);
        setAllDay(d.all_day);
        const s = new Date(d.starts_at);
        const e = new Date(d.ends_at);
        setStartInput(d.all_day ? toDateInputUtc(s) : toLocalInput(s));
        setEndInput(d.all_day ? toDateInputUtc(e) : toLocalInput(e));
        setColor(d.color);
        setLocation(d.location ?? "");
        setConferenceUrl(d.conference_url ?? "");
        setDescription(d.description ?? "");
        setReminder(d.reminder_minutes);
        setStatus((d.status as "confirmed" | "tentative" | "cancelled") ?? "confirmed");
        setBusyFlag(d.busy);
        setAttendees(new Set((d.attendees ?? []).filter((a) => !a.is_organizer).map((a) => a.user_id)));
        setLinks(d.links ?? []);

        const rule = parseRecurrence(d.recurrence);
        if (rule) {
          setRepeatFreq(rule.freq);
          setRepeatInterval(rule.interval);
          setRepeatDays(new Set(rule.byDay));
        }
        if (d.recurrence_until) setRepeatUntil(toDateInputUtc(new Date(d.recurrence_until)));
      },
      () => {
        if (!cancelled) {
          setLoading(false);
          setError("Could not load this event.");
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [mode]);

  // 붙어 있는 자료의 제목/소유자 — 한 번에 받아 온다.
  useEffect(() => {
    const missing = links.filter((l) => !linkCards.has(`${l.kind}:${l.id}`));
    if (missing.length === 0) return;
    let cancelled = false;
    getObjectCards(missing).then(
      (rows) => {
        if (cancelled || rows.length === 0) return;
        setLinkCards((prev) => {
          const next = new Map(prev);
          for (const row of rows) next.set(`${row.kind}:${row.id}`, row);
          return next;
        });
      },
      () => {}
    );
    return () => {
      cancelled = true;
    };
    // linkCards 를 의존성에 넣으면 서버가 못 돌려준 항목에서 무한 반복이 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links]);

  // ---- 첨부 후보 ----
  useEffect(() => {
    if (!linkPicker) return;
    const q = attachQuery.trim();
    const timer = setTimeout(() => {
      listAttachables(q).then(setAttachables, () => setAttachables([]));
    }, q ? 220 : 0);
    return () => clearTimeout(timer);
  }, [linkPicker, attachQuery]);

  const recurrenceString = useMemo(() => {
    if (repeatFreq === "none") return null;
    return formatRecurrence({
      freq: repeatFreq,
      interval: Math.max(1, repeatInterval),
      byDay: repeatFreq === "WEEKLY" ? [...repeatDays].sort((a, b) => a - b) : [],
      count: null,
    });
  }, [repeatFreq, repeatInterval, repeatDays]);

  const toggleAttendee = (id: string) =>
    setAttendees((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleRepeatDay = (day: number) =>
    setRepeatDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });

  /** 종일/시간 지정 전환 시 입력 형식을 맞춘다 — 값이 사라지면 안 된다. */
  const switchAllDay = (next: boolean) => {
    const s = allDay ? fromDateInputUtc(startInput) : new Date(startInput);
    const e = allDay ? fromDateInputUtc(endInput, true) : new Date(endInput);
    setAllDay(next);
    if (!s || Number.isNaN(s.getTime())) return;
    if (next) {
      // 시각이 있던 값에서 넘어올 때는 **로컬** 날짜를 집는다. UTC 로 읽으면
      // 시차에 따라 하루가 밀린다.
      setStartInput(toDateInputLocal(s));
      setEndInput(toDateInputLocal(e && !Number.isNaN(e.getTime()) ? e : s));
    } else {
      // UTC 자정 → 그 날 09:00 로컬. 종일에서 돌아올 때 0시가 되면 늘 고쳐야 한다.
      const local = new Date(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate(), 9, 0);
      setStartInput(toLocalInput(local));
      setEndInput(toLocalInput(new Date(local.getTime() + 60 * 60 * 1000)));
    }
  };

  /**
   * 반복 일정을 눌러서 연 경우에만 "이 일정만 / 전체" 를 물어볼 수 있다.
   * 규칙 자체(반복 주기·요일)를 바꾸는 것은 언제나 전체에 적용된다 — 그래서
   * 규칙을 건드렸으면 묻지 않고 바로 전체로 저장한다.
   */
  const occurrenceStart = mode.kind === "existing" ? mode.occurrenceStart : undefined;
  /** 반복 일정의 특정 발생을 눌러서 연 경우에만 범위를 물어볼 수 있다. */
  const canScope = !!detail?.recurrence && !!occurrenceStart && editable;
  /** 반복 규칙 자체를 고쳤다면 "이 일정만" 은 말이 안 된다 — 늘 전체다. */
  const ruleChanged =
    !!detail &&
    ((recurrenceString ?? null) !== (detail.recurrence ?? null) ||
      (repeatUntil ? fromDateInputUtc(repeatUntil, true)?.toISOString() : null) !==
        (detail.recurrence_until ?? null));

  const onSave = async (scope: OccurrenceScope = "all") => {
    if (busy) return;
    setError(null);

    const start = allDay ? fromDateInputUtc(startInput) : new Date(startInput);
    const end = allDay ? fromDateInputUtc(endInput, true) : new Date(endInput);
    if (!start || Number.isNaN(start.getTime()) || !end || Number.isNaN(end.getTime())) {
      setError("Pick a start and an end.");
      return;
    }

    setBusy(true);

    // 서버 액션은 던지지 않지만(actions.ts) 브라우저↔서버 왕복 자체가 네트워크
    // 순간 장애로 reject 할 수 있다 — try/finally 로 감싸 어느 경우든 busy 를
    // 반드시 풀어준다. 안 그러면 "Saving…" 에서 멈춘 채 다시 시도할 방법이
    // 없다.
    try {
      // "이 일정만" — 먼저 그 발생을 단발 일정으로 떼어내고, 그 새 일정에 저장한다.
      // 원본에는 예외가 남아 그 날짜는 더 이상 반복에서 나오지 않는다.
      let targetId = mode.kind === "existing" ? mode.eventId : null;
      const detaching = scope === "this" && mode.kind === "existing" && !!occurrenceStart;
      if (detaching && mode.kind === "existing" && occurrenceStart) {
        const detached = await detachOccurrence(mode.eventId, occurrenceStart);
        if ("error" in detached) {
          setError(detached.error);
          return;
        }
        targetId = detached.id;
      }

      const res = await saveEvent({
        id: targetId,
        calendarId,
        title,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        allDay,
        description,
        color,
        location,
        conferenceUrl,
        // 반복 일정이 시차를 넘어도 원래 의도를 알 수 있게 만든 사람의 시간대를 남긴다.
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        // 떼어낸 일정은 더 이상 반복이 아니다 — 규칙을 다시 붙이면 원본과
        // 겹쳐서 같은 날에 두 번 나온다.
        recurrence: detaching ? null : recurrenceString,
        recurrenceUntil: detaching
          ? null
          : repeatUntil
            ? (fromDateInputUtc(repeatUntil, true)?.toISOString() ?? null)
            : null,
        reminderMinutes: reminder,
        status,
        busy: busyFlag,
        attendees: [...attendees],
      });

      if ("error" in res) {
        setError(res.error);
        return;
      }
      onSaved();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (scope: OccurrenceScope = "all") => {
    if (mode.kind !== "existing") return;
    const question =
      scope === "this"
        ? "Remove just this one occurrence?"
        : `Delete “${title}”? Everyone invited loses it${detail?.recurrence ? ", every occurrence" : ""} too.`;
    if (!confirm(question)) return;

    setBusy(true);
    try {
      const res =
        scope === "this" && occurrenceStart
          ? await deleteOccurrence(mode.eventId, occurrenceStart)
          : await deleteEvent(mode.eventId);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      onSaved();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const onRespond = async (response: "accepted" | "declined" | "tentative") => {
    if (mode.kind !== "existing") return;
    setBusy(true);
    try {
      const res = await respondToEvent(mode.eventId, response);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setDetail((d) => (d ? { ...d, my_response: response } : d));
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const addLink = useCallback(
    async (item: AttachableObject) => {
      if (mode.kind !== "existing") return;
      setLinkPicker(false);
      try {
        const res = await linkEventObject(mode.eventId, item.kind, item.id);
        if ("error" in res) setError(res.error);
        else setLinks((prev) => [...prev, { kind: item.kind, id: item.id }]);
      } catch {
        setError("Something went wrong. Please try again.");
      }
    },
    [mode]
  );

  const removeLink = async (kind: string, id: string) => {
    if (mode.kind !== "existing") return;
    try {
      const res = await unlinkEventObject(mode.eventId, kind, id);
      if ("error" in res) setError(res.error);
      else setLinks((prev) => prev.filter((l) => !(l.kind === kind && l.id === id)));
    } catch {
      setError("Something went wrong. Please try again.");
    }
  };

  const myResponse = detail?.my_response;
  const amInvited = !!detail?.attendees?.some((a) => a.user_id === selfId && !a.is_organizer);

  if (loading) {
    return (
      <Modal title="Event" onClose={onClose} width={620}>
        <div className="empty">Loading…</div>
      </Modal>
    );
  }

  return (
    <Modal
      title={mode.kind === "new" ? "New event" : editable ? "Edit event" : title || "Event"}
      onClose={onClose}
      width={620}
    >
      {error && <div className="notice notice-error">{error}</div>}

      {/* 초대받은 사람에게 가장 먼저 필요한 것은 편집이 아니라 "갈 건가?" 다. */}
      {amInvited && (
        <div className="cal-rsvp">
          <span className="label">YOUR RESPONSE</span>
          <div className="row" style={{ gap: 6 }}>
            {(["accepted", "tentative", "declined"] as const).map((r) => (
              <button
                key={r}
                className={`btn btn-sm ${myResponse === r ? "btn-primary" : ""}`}
                disabled={busy}
                onClick={() => onRespond(r)}
              >
                {r === "accepted" ? "Going" : r === "tentative" ? "Maybe" : "Can't go"}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <label className="label" htmlFor="cal-title">TITLE</label>
        <input
          id="cal-title"
          className="input"
          value={title}
          maxLength={200}
          disabled={!editable}
          placeholder="Weekly sync"
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="cal-grid-2">
        <div className="field">
          <label className="label" htmlFor="cal-cal">CALENDAR</label>
          <select
            id="cal-cal"
            className="select"
            value={calendarId}
            disabled={!editable}
            onChange={(e) => setCalendarId(e.target.value)}
          >
            {writable.length === 0 && <option value="">No writable calendar</option>}
            {writable.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
            {/* 읽기 전용 달력의 일정을 열었을 때 이름이라도 보이게. */}
            {detail && !writable.some((c) => c.id === detail.calendar_id) && (
              <option value={detail.calendar_id}>{detail.calendar_name}</option>
            )}
          </select>
        </div>
        <div className="field">
          <label className="label">WHEN</label>
          <label className="cal-check">
            <input
              type="checkbox"
              checked={allDay}
              disabled={!editable}
              onChange={(e) => switchAllDay(e.target.checked)}
            />
            All day
          </label>
        </div>
      </div>

      <div className="cal-grid-2">
        <div className="field">
          <label className="label" htmlFor="cal-start">STARTS</label>
          <input
            id="cal-start"
            className="input"
            type={allDay ? "date" : "datetime-local"}
            value={startInput}
            disabled={!editable}
            onChange={(e) => setStartInput(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="cal-end">ENDS</label>
          <input
            id="cal-end"
            className="input"
            type={allDay ? "date" : "datetime-local"}
            value={endInput}
            disabled={!editable}
            onChange={(e) => setEndInput(e.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label className="label">COLOUR</label>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {EVENT_COLOR_PRESETS.map((p) => (
            <Tooltip key={p.label} content={p.label}>
              <button
                type="button"
                className={`cal-color ${color === p.value ? "on" : ""} ${p.value === null ? "cal-color-inherit" : ""}`}
                style={p.value ? { background: p.value } : undefined}
                disabled={!editable}
                onClick={() => setColor(p.value)}
                aria-label={`Colour: ${p.label}`}
              />
            </Tooltip>
          ))}
        </div>
      </div>

      <div className="cal-grid-2">
        <div className="field">
          <label className="label" htmlFor="cal-loc">LOCATION</label>
          <input
            id="cal-loc"
            className="input"
            value={location}
            maxLength={300}
            disabled={!editable}
            placeholder="Room A"
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="cal-url">MEETING LINK</label>
          <div className="row" style={{ gap: 6 }}>
            <input
              id="cal-url"
              className="input"
              style={{ flex: 1, minWidth: 0 }}
              value={conferenceUrl}
              maxLength={500}
              disabled={!editable}
              placeholder="https://…"
              onChange={(e) => setConferenceUrl(e.target.value)}
            />
            {/* 링크를 넣어 두기만 하고 열 수 없으면 그 필드는 존재할 이유가 없다. */}
            {/^https?:\/\//i.test(conferenceUrl.trim()) && (
              <a
                className="btn btn-sm"
                href={conferenceUrl.trim()}
                target="_blank"
                rel="noopener noreferrer"
              >
                Join
              </a>
            )}
          </div>
        </div>
      </div>

      {/* ---- 반복 ---- */}
      <div className="field">
        <label className="label">REPEATS</label>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <select
            className="select"
            style={{ width: 150 }}
            value={repeatFreq}
            disabled={!editable}
            onChange={(e) => setRepeatFreq(e.target.value as "none" | Freq)}
            aria-label="Repeat frequency"
          >
            <option value="none">Does not repeat</option>
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
            <option value="YEARLY">Yearly</option>
          </select>
          {repeatFreq !== "none" && (
            <>
              <span className="muted" style={{ fontSize: 12 }}>every</span>
              <input
                className="input"
                type="number"
                min={1}
                max={99}
                style={{ width: 70 }}
                value={repeatInterval}
                disabled={!editable}
                onChange={(e) => setRepeatInterval(Math.max(1, Number(e.target.value) || 1))}
                aria-label="Repeat interval"
              />
              <span className="muted" style={{ fontSize: 12 }}>
                {repeatFreq === "DAILY" ? "day(s)" : repeatFreq === "WEEKLY" ? "week(s)" : repeatFreq === "MONTHLY" ? "month(s)" : "year(s)"}
              </span>
            </>
          )}
        </div>
        {repeatFreq === "WEEKLY" && (
          <div className="cal-days">
            {DAY_LABELS.map((label, day) => (
              <button
                key={label}
                type="button"
                className={`cal-day-toggle ${repeatDays.has(day) ? "on" : ""}`}
                disabled={!editable}
                onClick={() => toggleRepeatDay(day)}
              >
                {label[0]}
              </button>
            ))}
          </div>
        )}
        {repeatFreq !== "none" && (
          <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <span className="muted" style={{ fontSize: 12 }}>until</span>
            <input
              className="input"
              type="date"
              style={{ width: 170 }}
              value={repeatUntil}
              disabled={!editable}
              onChange={(e) => setRepeatUntil(e.target.value)}
              aria-label="Repeat until"
            />
            <span className="muted" style={{ fontSize: 12 }}>
              {describeRecurrence(recurrenceString, allDay ? undefined : new Date(startInput))}
              {!repeatUntil && " · forever"}
            </span>
          </div>
        )}
      </div>

      {/* ---- 참석자 ---- */}
      <div className="field">
        <label className="label">GUESTS ({attendees.size})</label>
        <div className="cal-guests">
          {contacts.length === 0 && <div className="empty">No co-workers to invite yet.</div>}
          {contacts.map((c) => {
            const on = attendees.has(c.id);
            const responded = detail?.attendees?.find((a) => a.user_id === c.id);
            return (
              <button
                key={c.id}
                type="button"
                className={`cal-guest ${on ? "on" : ""}`}
                disabled={!editable}
                onClick={() => toggleAttendee(c.id)}
              >
                <UserAvatar url={c.avatar_url} name={c.name} size={22} />
                <span className="cal-guest-name">{c.name}</span>
                {responded && responded.response !== "needs_action" && (
                  <span className={`cal-rsvp-dot ${responded.response}`} title={responded.response} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="cal-grid-2">
        <div className="field">
          <label className="label" htmlFor="cal-remind">REMINDER</label>
          <select
            id="cal-remind"
            className="select"
            value={reminder === null ? "" : String(reminder)}
            disabled={!editable}
            onChange={(e) => setReminder(e.target.value === "" ? null : Number(e.target.value))}
          >
            {REMINDER_CHOICES.map((r) => (
              <option key={String(r.value)} value={r.value === null ? "" : String(r.value)}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="cal-status">STATUS</label>
          <select
            id="cal-status"
            className="select"
            value={status}
            disabled={!editable}
            onChange={(e) => setStatus(e.target.value as "confirmed" | "tentative" | "cancelled")}
          >
            <option value="confirmed">Confirmed</option>
            <option value="tentative">Tentative</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      <div className="field">
        <label className="cal-check">
          <input
            type="checkbox"
            checked={busyFlag}
            disabled={!editable}
            onChange={(e) => setBusyFlag(e.target.checked)}
          />
          Show me as busy during this event
        </label>
      </div>

      <div className="field">
        <label className="label" htmlFor="cal-desc">NOTES</label>
        <textarea
          id="cal-desc"
          className="input"
          rows={3}
          style={{ height: "auto", padding: "8px 10px", resize: "vertical" }}
          value={description}
          maxLength={5000}
          disabled={!editable}
          placeholder="Agenda, links, anything the guests should read first."
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      {/* ---- 붙어 있는 자료 ---- */}
      {mode.kind === "new" && (
        <div className="field">
          <label className="label">ATTACHED ITEMS</label>
          <span className="muted" style={{ fontSize: 12 }}>
            Create the event first, then reopen it to attach the docs and files
            everyone should read beforehand.
          </span>
        </div>
      )}
      {mode.kind === "existing" && (
        <div className="field">
          <label className="label">ATTACHED ITEMS ({links.length})</label>
          <div className="cal-links">
            {links.length === 0 && (
              <span className="muted" style={{ fontSize: 12 }}>
                Nothing attached — add the doc everyone should read before this meeting.
              </span>
            )}
            {links.map((l) => {
              const card = linkCards.get(`${l.kind}:${l.id}`);
              const label = card?.title ?? (card ? "No access" : "Loading…");
              return (
                <span
                  key={`${l.kind}:${l.id}`}
                  className={`cal-link-chip ${card && !card.can_view ? "locked" : ""}`}
                >
                  <span className="chat-ref-kind">{KIND_LABEL[l.kind] ?? l.kind}</span>
                  {l.kind === "file" || !card?.can_view ? (
                    <span className="cal-link-name" title={label}>{label}</span>
                  ) : (
                    <OpenItemButton
                      kind={l.kind as "document" | "code" | "sheet" | "mindmap"}
                      id={l.id}
                      title={label}
                      className="cal-link-name link-btn"
                    >
                      {label}
                    </OpenItemButton>
                  )}
                  {editable && (
                    <button
                      type="button"
                      className="cal-link-x"
                      onClick={() => removeLink(l.kind, l.id)}
                      aria-label={`Remove ${label}`}
                    >
                      <IconClose size={10} />
                    </button>
                  )}
                </span>
              );
            })}
          </div>
          {editable && (
            <div style={{ marginTop: 8 }}>
              <button className="btn btn-sm" onClick={() => setLinkPicker((v) => !v)}>
                {linkPicker ? "Cancel" : "+ Attach an item"}
              </button>
            </div>
          )}
          {linkPicker && (
            <div className="cal-picker">
              <input
                className="input"
                placeholder="Search docs, tables, code, files…"
                value={attachQuery}
                onChange={(e) => setAttachQuery(e.target.value)}
              />
              <div className="cal-picker-list">
                {!attachables && <div className="empty">Loading…</div>}
                {attachables?.filter((a) => a.kind !== "event").length === 0 && (
                  <div className="empty">Nothing matches.</div>
                )}
                {attachables
                  ?.filter((a) => a.kind !== "event")
                  .map((item) => (
                    <button
                      key={`${item.kind}:${item.id}`}
                      className="cal-picker-row"
                      onClick={() => addLink(item)}
                    >
                      <span className="chat-ref-kind">{KIND_LABEL[item.kind] ?? item.kind}</span>
                      <span className="cal-picker-title">{item.title}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 반복 일정의 한 발생을 눌러서 열었다면, 무엇에 적용할지 먼저 정한다.
          Google/Outlook 이 저장 뒤에 묻는 것과 달리 미리 보여 준다 — 버튼에
          무슨 일이 일어날지 적혀 있으면 되돌릴 일이 줄어든다. */}
      {canScope && !ruleChanged && (
        <div className="cal-scope">
          <span className="label">THIS IS A REPEATING EVENT</span>
          <span className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
            {describeRecurrence(detail?.recurrence ?? null, new Date(detail?.starts_at ?? Date.now()))}.
            Choose whether your change applies to the one you opened or to every occurrence.
          </span>
        </div>
      )}
      {canScope && ruleChanged && (
        <div className="notice notice-info">
          You changed how often this repeats, so saving updates every occurrence.
        </div>
      )}

      <div className="cal-dialog-actions">
        {mode.kind === "existing" && detail && (
          <SendToChatButton
            kind={"event" as ObjectKind}
            id={mode.eventId}
            title={title || "Event"}
            canGrant={false}
            label="Send to chat"
            className="btn btn-sm"
          />
        )}
        <span style={{ flex: 1 }} />
        {mode.kind === "existing" && editable && (
          <>
            {canScope && (
              <button
                className="btn btn-sm btn-danger"
                onClick={() => onDelete("this")}
                disabled={busy}
              >
                Delete this one
              </button>
            )}
            <button className="btn btn-sm btn-danger" onClick={() => onDelete("all")} disabled={busy}>
              {canScope ? "Delete all" : "Delete"}
            </button>
          </>
        )}
        {editable && canScope && !ruleChanged && (
          <button
            className="btn btn-sm"
            onClick={() => onSave("this")}
            disabled={busy || !title.trim() || !calendarId}
          >
            {busy ? "Saving…" : "Save this one"}
          </button>
        )}
        {editable && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => onSave("all")}
            disabled={busy || !title.trim() || !calendarId}
          >
            {busy
              ? "Saving…"
              : mode.kind === "new"
                ? "Create event"
                : canScope && !ruleChanged
                  ? "Save all"
                  : "Save"}
          </button>
        )}
      </div>
    </Modal>
  );
}
