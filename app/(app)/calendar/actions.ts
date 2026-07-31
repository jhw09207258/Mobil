"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser as requireUser } from "@/lib/auth";
import { isNextControlFlowError } from "@/lib/next-control-flow";
import { parseIcs } from "@/lib/ics";
import { nextReminderAt } from "@/lib/recurrence";
import { pushConfigured, sendPush, type PushTarget } from "@/lib/push";
import { measure } from "@/lib/observability";

/**
 * 캘린더 서버 액션.
 *
 * 반복 일정을 실제 날짜로 펴는 일은 여기서 하지 않는다 — 규칙만 내려보내고
 * 화면(lib/recurrence.ts)이 보이는 범위만 편다. 그래야 "3년 뒤까지 매주" 같은
 * 일정이 서버 응답을 부풀리지 않는다.
 */

export type CalendarSummary = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  is_default: boolean;
  owner_id: string;
  owner_name: string;
  my_role: "owner" | "editor" | "viewer";
  member_count: number;
  event_count: number;
};

export type CalendarEventRow = {
  id: string;
  calendar_id: string;
  calendar_name: string;
  calendar_color: string;
  created_by: string;
  created_by_name: string;
  title: string;
  description: string | null;
  location: string | null;
  conference_url: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  time_zone: string;
  color: string | null;
  recurrence: string | null;
  recurrence_until: string | null;
  reminder_minutes: number | null;
  status: string;
  busy: boolean;
  repository_id: string | null;
  attendee_count: number;
  accepted_count: number;
  my_response: string | null;
  is_invited: boolean;
  link_count: number;
  can_edit: boolean;
  /** "이 일정만 삭제/수정" 으로 빠진 발생들(EXDATE). */
  exceptions: string[];
  /** 반복에서 떼어낸 일정이면 원본 id. */
  detached_from: string | null;
};

export type EventAttendee = {
  user_id: string;
  name: string;
  avatar_url: string | null;
  response: "needs_action" | "accepted" | "declined" | "tentative";
  is_organizer: boolean;
};

export type EventDetail = CalendarEventRow & {
  attendees: EventAttendee[];
  links: { kind: string; id: string }[];
};

/** 반복 일정을 고칠 때 어디까지 바꾸는가. */
export type OccurrenceScope = "all" | "this";

export type CalendarMember = {
  user_id: string;
  name: string;
  avatar_url: string | null;
  role: "viewer" | "editor";
  added_at: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 아래 모든 액션이 공유하는 실패 처리. createClient()/RPC 가 네트워크 순간
 * 장애나 (한때 실제로 있었던) 누락된 환경변수로 던지면, 어느 것도 감싸여 있지
 * 않은 채로는 이 파일 전체가 Server Action 의 미처리 예외가 되고, 그걸 기다리는
 * calendar-shell.tsx 의 버튼은 응답을 영원히 못 받아 "저장 중…" 에서 멈춘다
 * — "달력 추가조차 안 된다" 로 보고된 바로 그 증상이다. requireUser() 가
 * 승인 대기 사용자를 /pending-approval 로 보낼 때 던지는 NEXT_REDIRECT 는
 * 실패가 아니라 제어 흐름 신호이므로 그대로 다시 던진다(로그인 액션들과 같은
 * 원칙, lib/auth.ts 참고).
 */
function logUnexpected(action: string, e: unknown): void {
  console.error(`[calendar:${action}] unexpected failure:`, e instanceof Error ? e.message : e);
}

/** 처음 들어오면 기본 달력을 하나 만들어 준다. */
export async function ensureDefaultCalendar(): Promise<string | null> {
  try {
    await requireUser();
    const supabase = await createClient();
    const { data } = await supabase.rpc("ensure_default_calendar");
    return data ?? null;
  } catch (e) {
    if (isNextControlFlowError(e)) throw e;
    logUnexpected("ensureDefaultCalendar", e);
    return null;
  }
}

export async function listCalendars(): Promise<CalendarSummary[]> {
  try {
    await requireUser();
    const supabase = await createClient();
    const { data } = await supabase.rpc("list_calendars");
    return (data ?? []) as CalendarSummary[];
  } catch (e) {
    if (isNextControlFlowError(e)) throw e;
    logUnexpected("listCalendars", e);
    return [];
  }
}

export async function listEvents(from: string, to: string): Promise<CalendarEventRow[]> {
  try {
    await requireUser();
    const supabase = await createClient();
    const { data, error } = await measure(supabase, "calendar.month", async () =>
      supabase.rpc("list_calendar_events", { p_from: from, p_to: to })
    );
    if (error) return [];
    return (data ?? []) as CalendarEventRow[];
  } catch (e) {
    if (isNextControlFlowError(e)) throw e;
    logUnexpected("listEvents", e);
    return [];
  }
}

export async function getEvent(eventId: string): Promise<EventDetail | null> {
  try {
    await requireUser();
    if (!UUID_RE.test(eventId)) return null;
    const supabase = await createClient();
    const { data } = await supabase.rpc("get_calendar_event", { p_event: eventId });
    return (data as unknown as EventDetail) ?? null;
  } catch (e) {
    if (isNextControlFlowError(e)) throw e;
    logUnexpected("getEvent", e);
    return null;
  }
}

export type SaveEventInput = {
  id?: string | null;
  calendarId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay?: boolean;
  description?: string | null;
  location?: string | null;
  conferenceUrl?: string | null;
  timeZone?: string;
  color?: string | null;
  recurrence?: string | null;
  recurrenceUntil?: string | null;
  reminderMinutes?: number | null;
  status?: "confirmed" | "tentative" | "cancelled";
  busy?: boolean;
  repositoryId?: string | null;
  attendees?: string[];
};

export async function saveEvent(
  input: SaveEventInput
): Promise<{ id: string } | { error: string }> {
  try {
    await requireUser();

    const title = input.title.trim();
    if (!title) return { error: "Give the event a title." };
    if (title.length > 200) return { error: "Title is too long (max 200 characters)." };
    if (!UUID_RE.test(input.calendarId)) return { error: "Pick a calendar." };

    const start = new Date(input.startsAt);
    const end = new Date(input.endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return { error: "Those dates aren't valid." };
    }
    if (end.getTime() < start.getTime()) return { error: "The event ends before it starts." };

    // 회의 링크는 http(s) 만 — javascript: 같은 스킴이 링크로 렌더되면 안 된다.
    const conference = input.conferenceUrl?.trim() || null;
    if (conference && !/^https?:\/\//i.test(conference)) {
      return { error: "The meeting link must start with http:// or https://" };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("save_calendar_event", {
      p_id: input.id ?? null,
      p_calendar: input.calendarId,
      p_title: title,
      p_starts_at: start.toISOString(),
      p_ends_at: end.toISOString(),
      p_all_day: !!input.allDay,
      p_description: input.description?.trim() || null,
      p_location: input.location?.trim() || null,
      p_conference_url: conference,
      p_time_zone: input.timeZone || "UTC",
      p_color: input.color || null,
      p_recurrence: input.recurrence || null,
      p_recurrence_until: input.recurrenceUntil || null,
      p_reminder_minutes: input.reminderMinutes ?? null,
      p_status: input.status ?? "confirmed",
      p_busy: input.busy ?? true,
      p_repository: input.repositoryId ?? null,
      p_attendees: (input.attendees ?? []).filter((a) => UUID_RE.test(a)),
    });

    if (error || !data) {
      return { error: describeDbError(error?.message, "Could not save this event.") };
    }

    const eventId = data;

    // 알림 예약과 초대 푸시는 저장 결과를 붙잡지 않는다 — 실패해도 일정은 남는다.
    after(async () => {
      await scheduleNextReminder(supabase, eventId, {
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        allDay: !!input.allDay,
        timeZone: input.timeZone || "UTC",
        recurrence: input.recurrence ?? null,
        recurrenceUntil: input.recurrenceUntil ?? null,
        reminderMinutes: input.reminderMinutes ?? null,
      });
      await notifyInvitees(supabase, eventId, title, start, !!input.allDay, input.timeZone);
    });

    return { id: eventId };
  } catch (e) {
    if (isNextControlFlowError(e)) throw e;
    logUnexpected("saveEvent", e);
    return { error: "Something went wrong on our end. Please try again." };
  }
}

/**
 * 다음 알림 시각을 계산해 DB 에 넣는다.
 *
 * 반복 전개는 앱에만 있으므로(0069 주석 참고) DB 는 "언제" 를 스스로 알 수
 * 없다. 저장할 때 한 번, 그리고 발송기가 보낸 뒤 한 번 더 채운다.
 */
async function scheduleNextReminder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  event: {
    startsAt: string;
    endsAt: string;
    allDay: boolean;
    timeZone: string;
    recurrence: string | null;
    recurrenceUntil: string | null;
    reminderMinutes: number | null;
  }
): Promise<void> {
  try {
    // 예외(EXDATE)까지 반영해야 정확하다 — 저장 직후라 다시 읽는다.
    const { data: detail } = await supabase.rpc("get_calendar_event", { p_event: eventId });
    const exceptions = ((detail as { exceptions?: string[] } | null)?.exceptions ?? []) as string[];

    const at = nextReminderAt({
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      allDay: event.allDay,
      timeZone: event.timeZone,
      recurrence: event.recurrence,
      recurrenceUntil: event.recurrenceUntil,
      exceptions,
      reminderMinutes: event.reminderMinutes,
    });

    await supabase.rpc("set_next_reminder", {
      p_event: eventId,
      p_at: at ? at.toISOString() : null,
    });
  } catch {
    /* 알림 예약 실패가 일정 저장을 되돌리지는 않는다. */
  }
}

/** 초대받은 사람에게 즉시 푸시. 실시간 알림(0067)은 앱을 열어 둔 사람만 받는다. */
async function notifyInvitees(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  title: string,
  start: Date,
  allDay: boolean,
  timeZone: string | undefined
): Promise<void> {
  if (!pushConfigured()) return;
  try {
    const { data } = await supabase.rpc("claim_event_push_recipients", {
      p_event: eventId,
      p_users: null,
    });
    const targets = (data ?? []) as PushTarget[];
    if (targets.length === 0) return;

    const when = allDay
      ? start.toLocaleDateString("en-US", { timeZone: "UTC", dateStyle: "medium" })
      : start.toLocaleString("en-US", {
          timeZone: timeZone || "UTC",
          dateStyle: "medium",
          timeStyle: "short",
        });

    const result = await sendPush(targets, {
      title: "Calendar invitation",
      body: `${title} · ${when}`,
      url: `/calendar?event=${eventId}`,
      tag: `event-invite:${eventId}`,
    });
    for (const endpoint of result.gone) {
      await supabase.rpc("prune_push_subscription", { p_endpoint: endpoint }).then(
        () => {},
        () => {}
      );
    }
  } catch {
    /* 알림 실패가 일정 저장을 되돌리지는 않는다. */
  }
}

/**
 * 반복 일정에서 이 발생만 삭제 — 규칙은 그대로 두고 그 날짜만 뺀다.
 */
export async function deleteOccurrence(
  eventId: string,
  occurrenceStart: string
): Promise<{ ok: true } | { error: string }> {
  try {
    await requireUser();
    if (!UUID_RE.test(eventId)) return { error: "Invalid event." };
    const when = new Date(occurrenceStart);
    if (Number.isNaN(when.getTime())) return { error: "Invalid occurrence." };

    const supabase = await createClient();
    const { error } = await supabase.rpc("delete_event_occurrence", {
      p_event: eventId,
      p_occurrence_start: when.toISOString(),
    });
    if (error) {
      return { error: describeDbError(error.message, "Could not remove that occurrence.") };
    }
    return { ok: true };
  } catch (e) {
    if (isNextControlFlowError(e)) throw e;
    logUnexpected("deleteOccurrence", e);
    return { error: "Something went wrong on our end. Please try again." };
  }
}

/**
 * 이 발생만 따로 떼어낸다 — 같은 내용의 단발 일정이 만들어지고, 원본에는
 * 예외가 남는다. 이후에는 평범한 일정이라 기존 편집이 그대로 통한다.
 */
export async function detachOccurrence(
  eventId: string,
  occurrenceStart: string
): Promise<{ id: string } | { error: string }> {
  try {
    await requireUser();
    if (!UUID_RE.test(eventId)) return { error: "Invalid event." };
    const when = new Date(occurrenceStart);
    if (Number.isNaN(when.getTime())) return { error: "Invalid occurrence." };

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("detach_event_occurrence", {
      p_event: eventId,
      p_occurrence_start: when.toISOString(),
    });
    if (error || !data) {
      return { error: describeDbError(error?.message, "Could not separate that occurrence.") };
    }
    return { id: data };
  } catch (e) {
    if (isNextControlFlowError(e)) throw e;
    logUnexpected("detachOccurrence", e);
    return { error: "Something went wrong on our end. Please try again." };
  }
}

export async function deleteEvent(eventId: string): Promise<{ ok: true } | { error: string }> {
  try {
    await requireUser();
    if (!UUID_RE.test(eventId)) return { error: "Invalid event." };
    const supabase = await createClient();
    const { error } = await supabase.rpc("delete_calendar_event", { p_event: eventId });
    if (error) return { error: "Only the organiser or a calendar editor can delete this event." };
    return { ok: true };
  } catch (e) {
    if (isNextControlFlowError(e)) throw e;
    logUnexpected("deleteEvent", e);
    return { error: "Something went wrong on our end. Please try again." };
  }
}

export async function respondToEvent(
  eventId: string,
  response: "accepted" | "declined" | "tentative"
): Promise<{ ok: true } | { error: string }> {
  try {
    await requireUser();
    if (!UUID_RE.test(eventId)) return { error: "Invalid event." };
    const supabase = await createClient();
    const { error } = await supabase.rpc("respond_to_event", {
      p_event: eventId,
      p_response: response,
    });
    if (error) return { error: "You are not on the guest list for this event." };
    return { ok: true };
  } catch (e) {
    if (isNextControlFlowError(e)) throw e;
    logUnexpected("respondToEvent", e);
    return { error: "Something went wrong on our end. Please try again." };
  }
}

// ---------------------------------------------------------------- 달력 관리

export async function createCalendar(
  name: string,
  color: string
): Promise<{ id: string } | { error: string }> {
  try {
    const { userId } = await requireUser();
    const trimmed = name.trim();
    if (!trimmed) return { error: "Give the calendar a name." };
    if (trimmed.length > 80) return { error: "Name is too long (max 80 characters)." };
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { error: "Pick a colour." };

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("calendars")
      .insert({ owner_id: userId, name: trimmed, color })
      .select("id")
      .single();
    if (error || !data) return { error: "Could not create the calendar." };
    return { id: data.id };
  } catch (e) {
    if (isNextControlFlowError(e)) throw e;
    logUnexpected("createCalendar", e);
    return { error: "Something went wrong on our end. Please try again." };
  }
}

export async function renameCalendar(
  calendarId: string,
  name: string,
  color: string
): Promise<{ ok: true } | { error: string }> {
  try {
    await requireUser();
    const trimmed = name.trim();
    if (!trimmed) return { error: "Give the calendar a name." };
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { error: "Pick a colour." };
    const supabase = await createClient();
    const { error } = await supabase
      .from("calendars")
      .update({ name: trimmed, color })
      .eq("id", calendarId);
    if (error) return { error: "Only the owner can rename this calendar." };
    return { ok: true };
  } catch (e) {
    if (isNextControlFlowError(e)) throw e;
    logUnexpected("renameCalendar", e);
    return { error: "Something went wrong on our end. Please try again." };
  }
}

export async function deleteCalendar(
  calendarId: string
): Promise<{ ok: true } | { error: string }> {
  try {
    await requireUser();
    const supabase = await createClient();
    const { error } = await supabase.from("calendars").delete().eq("id", calendarId);
    if (error) return { error: "Only the owner can delete this calendar." };
    return { ok: true };
  } catch (e) {
    if (isNextControlFlowError(e)) throw e;
    logUnexpected("deleteCalendar", e);
    return { error: "Something went wrong on our end. Please try again." };
  }
}

export async function listCalendarMembers(calendarId: string): Promise<CalendarMember[]> {
  try {
    await requireUser();
    if (!UUID_RE.test(calendarId)) return [];
    const supabase = await createClient();
    const { data } = await supabase.rpc("list_calendar_members", { p_calendar: calendarId });
    return (data ?? []) as CalendarMember[];
  } catch (e) {
    if (isNextControlFlowError(e)) throw e;
    logUnexpected("listCalendarMembers", e);
    return [];
  }
}

export async function shareCalendar(
  calendarId: string,
  userId: string,
  role: "viewer" | "editor"
): Promise<{ ok: true } | { error: string }> {
  try {
    await requireUser();
    if (!UUID_RE.test(calendarId) || !UUID_RE.test(userId)) return { error: "Invalid target." };
    const supabase = await createClient();
    const { error } = await supabase.rpc("share_calendar", {
      p_calendar: calendarId,
      p_user: userId,
      p_role: role,
    });
    if (error) return { error: "Could not share this calendar." };
    return { ok: true };
  } catch (e) {
    if (isNextControlFlowError(e)) throw e;
    logUnexpected("shareCalendar", e);
    return { error: "Something went wrong on our end. Please try again." };
  }
}

export async function unshareCalendar(
  calendarId: string,
  userId: string
): Promise<{ ok: true } | { error: string }> {
  try {
    await requireUser();
    const supabase = await createClient();
    const { error } = await supabase
      .from("calendar_members")
      .delete()
      .eq("calendar_id", calendarId)
      .eq("user_id", userId);
    if (error) return { error: "Could not remove that person." };
    return { ok: true };
  } catch (e) {
    if (isNextControlFlowError(e)) throw e;
    logUnexpected("unshareCalendar", e);
    return { error: "Something went wrong on our end. Please try again." };
  }
}

// ---------------------------------------------------------------- 자료 연결

export async function linkEventObject(
  eventId: string,
  kind: string,
  objectId: string
): Promise<{ ok: true } | { error: string }> {
  try {
    await requireUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("link_event_object", {
      p_event: eventId,
      p_kind: kind,
      p_id: objectId,
    });
    if (error) return { error: "Could not attach that item." };
    return { ok: true };
  } catch (e) {
    if (isNextControlFlowError(e)) throw e;
    logUnexpected("linkEventObject", e);
    return { error: "Something went wrong on our end. Please try again." };
  }
}

export async function unlinkEventObject(
  eventId: string,
  kind: string,
  objectId: string
): Promise<{ ok: true } | { error: string }> {
  try {
    await requireUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("unlink_event_object", {
      p_event: eventId,
      p_kind: kind,
      p_id: objectId,
    });
    if (error) return { error: "Could not remove that item." };
    return { ok: true };
  } catch (e) {
    if (isNextControlFlowError(e)) throw e;
    logUnexpected("unlinkEventObject", e);
    return { error: "Something went wrong on our end. Please try again." };
  }
}

// ---------------------------------------------------------------- ICS

/** 외부 캘린더(Google/Apple)에 넣을 구독 주소용 토큰. */
export async function getFeedToken(rotate = false): Promise<{ token: string } | { error: string }> {
  try {
    await requireUser();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_calendar_feed_token", { p_rotate: rotate });
    if (error || !data) return { error: "Could not create a subscription link." };
    return { token: data };
  } catch (e) {
    if (isNextControlFlowError(e)) throw e;
    logUnexpected("getFeedToken", e);
    return { error: "Something went wrong on our end. Please try again." };
  }
}

/** .ics 파일 가져오기. 우리가 저장할 수 있는 것만 취한다(참석자·첨부는 버린다). */
/**
 * 한 번에 가져올 수 있는 일정 수.
 *
 * 처음에는 일정마다 RPC 를 한 번씩 불러 200개가 상한이었다. 이제 한 문장으로
 * 통째로 넣으므로(import_calendar_events) 왕복이 한 번이고, 상한은 "한 트랜잭션
 * 에서 무리 없이 처리되는 양" 으로 다시 잡았다.
 */
const MAX_IMPORT = 2000;

export async function importIcs(
  calendarId: string,
  text: string
): Promise<{ imported: number; skipped: number; truncated: number } | { error: string }> {
  try {
    await requireUser();
    if (!UUID_RE.test(calendarId)) return { error: "Pick a calendar to import into." };
    if (text.length > 5 * 1024 * 1024) return { error: "That .ics file is too large (max 5MB)." };

    let parsed;
    try {
      parsed = parseIcs(text);
    } catch {
      return { error: "That file could not be read as a calendar." };
    }
    if (parsed.length === 0) return { error: "No events found in that file." };

    const supabase = await createClient();
    const batch = parsed.slice(0, MAX_IMPORT).map((e) => ({
      // 종일 일정은 UTC 자정에 맞춰 저장한다 — 표시와 ICS 내보내기가 시간대에
      // 흔들리지 않게 하는 기준점(0066 참고).
      title: e.title.slice(0, 200),
      starts_at: (e.allDay ? utcMidnight(e.startsAt) : e.startsAt).toISOString(),
      ends_at: (e.allDay ? utcEndOfDay(e.endsAt) : e.endsAt).toISOString(),
      all_day: e.allDay,
      description: e.description,
      location: e.location,
      conference_url: e.url && /^https?:\/\//i.test(e.url) ? e.url.slice(0, 500) : null,
      recurrence: e.recurrence,
      recurrence_until: e.recurrenceUntil ? e.recurrenceUntil.toISOString() : null,
      status: e.status === "cancelled" || e.status === "tentative" ? e.status : "confirmed",
    }));

    const { data: imported, error } = await supabase.rpc("import_calendar_events", {
      p_calendar: calendarId,
      p_events: batch,
    });
    if (error) {
      return { error: describeDbError(error.message, "Could not import those events.") };
    }

    const inserted = imported ?? 0;
    return {
      imported: inserted,
      skipped: batch.length - inserted,
      truncated: Math.max(0, parsed.length - MAX_IMPORT),
    };
  } catch (e) {
    if (isNextControlFlowError(e)) throw e;
    logUnexpected("importIcs", e);
    return { error: "Something went wrong on our end. Please try again." };
  }
}

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function utcEndOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59));
}

/**
 * SQL 이 raise exception 으로 던진 문장을 사용자에게 보여줄 수 있는 말로.
 * 원문을 그대로 노출하면 스키마 이름이 새어 나가고, 통째로 감추면 왜 안 되는지
 * 알 수 없다 — 우리가 의도적으로 던지는 몇 가지만 옮긴다.
 */
function describeDbError(message: string | undefined, fallback: string): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("no permission to add events")) {
    return "You can only add events to calendars you own or can edit.";
  }
  if (m.includes("no permission to edit")) return "You can't edit this event.";
  if (m.includes("no permission to move")) {
    return "You can't move this event into that calendar.";
  }
  if (m.includes("end must not be before start")) return "The event ends before it starts.";
  return fallback;
}
