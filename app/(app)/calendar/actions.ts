"use server";

import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser as requireUser } from "@/lib/auth";
import { parseIcs } from "@/lib/ics";
import { sendChatMessage } from "../chat/actions";

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

export type CalendarMember = {
  user_id: string;
  name: string;
  avatar_url: string | null;
  role: "viewer" | "editor";
  added_at: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 처음 들어오면 기본 달력을 하나 만들어 준다. */
export async function ensureDefaultCalendar(): Promise<string | null> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.rpc("ensure_default_calendar");
  return data ?? null;
}

export async function listCalendars(): Promise<CalendarSummary[]> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_calendars");
  return (data ?? []) as CalendarSummary[];
}

export async function listEvents(from: string, to: string): Promise<CalendarEventRow[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_calendar_events", {
    p_from: from,
    p_to: to,
  });
  if (error) return [];
  return (data ?? []) as CalendarEventRow[];
}

export async function getEvent(eventId: string): Promise<EventDetail | null> {
  await requireUser();
  if (!UUID_RE.test(eventId)) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_calendar_event", { p_event: eventId });
  return (data as unknown as EventDetail) ?? null;
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
  return { id: data };
}

export async function deleteEvent(eventId: string): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  if (!UUID_RE.test(eventId)) return { error: "Invalid event." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_calendar_event", { p_event: eventId });
  if (error) return { error: "Only the organiser or a calendar editor can delete this event." };
  return { ok: true };
}

export async function respondToEvent(
  eventId: string,
  response: "accepted" | "declined" | "tentative"
): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  if (!UUID_RE.test(eventId)) return { error: "Invalid event." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_to_event", {
    p_event: eventId,
    p_response: response,
  });
  if (error) return { error: "You are not on the guest list for this event." };
  return { ok: true };
}

// ---------------------------------------------------------------- 달력 관리

export async function createCalendar(
  name: string,
  color: string
): Promise<{ id: string } | { error: string }> {
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
}

export async function renameCalendar(
  calendarId: string,
  name: string,
  color: string
): Promise<{ ok: true } | { error: string }> {
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
}

export async function deleteCalendar(
  calendarId: string
): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("calendars").delete().eq("id", calendarId);
  if (error) return { error: "Only the owner can delete this calendar." };
  return { ok: true };
}

export async function listCalendarMembers(calendarId: string): Promise<CalendarMember[]> {
  await requireUser();
  if (!UUID_RE.test(calendarId)) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_calendar_members", { p_calendar: calendarId });
  return (data ?? []) as CalendarMember[];
}

export async function shareCalendar(
  calendarId: string,
  userId: string,
  role: "viewer" | "editor"
): Promise<{ ok: true } | { error: string }> {
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
}

export async function unshareCalendar(
  calendarId: string,
  userId: string
): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("calendar_members")
    .delete()
    .eq("calendar_id", calendarId)
    .eq("user_id", userId);
  if (error) return { error: "Could not remove that person." };
  return { ok: true };
}

// ---------------------------------------------------------------- 자료 연결

export async function linkEventObject(
  eventId: string,
  kind: string,
  objectId: string
): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("link_event_object", {
    p_event: eventId,
    p_kind: kind,
    p_id: objectId,
  });
  if (error) return { error: "Could not attach that item." };
  return { ok: true };
}

export async function unlinkEventObject(
  eventId: string,
  kind: string,
  objectId: string
): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("unlink_event_object", {
    p_event: eventId,
    p_kind: kind,
    p_id: objectId,
  });
  if (error) return { error: "Could not remove that item." };
  return { ok: true };
}

// ---------------------------------------------------------------- 채팅 연동

/** 일정을 대화로 보낸다 — 참석자 초대와는 별개로, 그냥 알리는 경로. */
export async function sendEventToChat(
  eventId: string,
  title: string,
  conversationId: string,
  note?: string
): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  if (!UUID_RE.test(eventId) || !UUID_RE.test(conversationId)) {
    return { error: "Invalid target." };
  }
  const safe = (title || "Event").replace(/[[\]|\n]/g, " ").trim().slice(0, 120);
  const body = [note?.trim(), `[[event:${eventId}|${safe || "Event"}]]`].filter(Boolean).join("\n");
  const sent = await sendChatMessage(conversationId, body);
  if ("error" in sent) return { error: sent.error };
  return { ok: true };
}

// ---------------------------------------------------------------- ICS

/** 외부 캘린더(Google/Apple)에 넣을 구독 주소용 토큰. */
export async function getFeedToken(rotate = false): Promise<{ token: string } | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_calendar_feed_token", { p_rotate: rotate });
  if (error || !data) return { error: "Could not create a subscription link." };
  return { token: data };
}

/** .ics 파일 가져오기. 우리가 저장할 수 있는 것만 취한다(참석자·첨부는 버린다). */
/**
 * 한 번에 가져올 수 있는 일정 수. 일정마다 RPC 를 한 번씩 부르므로, 서버리스
 * 함수의 실행 시간 안에 확실히 끝나는 선에서 자른다 — 절반쯤 넣다가 시간이
 * 끊겨 무엇이 들어갔는지 모르는 상태가 가장 나쁘다.
 */
const MAX_IMPORT = 200;

export async function importIcs(
  calendarId: string,
  text: string
): Promise<{ imported: number; skipped: number; truncated: number } | { error: string }> {
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
  let imported = 0;
  let skipped = 0;

  for (const e of parsed.slice(0, MAX_IMPORT)) {
    // 종일 일정은 UTC 자정에 맞춰 저장한다 — 표시와 ICS 내보내기가 시간대에
    // 흔들리지 않게 하는 기준점(0066 참고).
    const startsAt = e.allDay ? utcMidnight(e.startsAt) : e.startsAt;
    const endsAt = e.allDay ? utcEndOfDay(e.endsAt) : e.endsAt;

    const { error } = await supabase.rpc("save_calendar_event", {
      p_id: null,
      p_calendar: calendarId,
      p_title: e.title.slice(0, 200),
      p_starts_at: startsAt.toISOString(),
      p_ends_at: endsAt.toISOString(),
      p_all_day: e.allDay,
      p_description: e.description,
      p_location: e.location,
      p_conference_url: e.url && /^https?:\/\//i.test(e.url) ? e.url.slice(0, 500) : null,
      p_time_zone: "UTC",
      p_color: null,
      p_recurrence: e.recurrence,
      p_recurrence_until: e.recurrenceUntil ? e.recurrenceUntil.toISOString() : null,
      p_reminder_minutes: null,
      p_status: e.status === "cancelled" || e.status === "tentative" ? e.status : "confirmed",
      p_busy: true,
      p_repository: null,
      p_attendees: [],
    });
    if (error) skipped += 1;
    else imported += 1;
  }

  return { imported, skipped, truncated: Math.max(0, parsed.length - MAX_IMPORT) };
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
