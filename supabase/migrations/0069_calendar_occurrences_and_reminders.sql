-- ============================================================================
-- 캘린더 한계 시정 — "이번 것만" 수정/삭제 · 알림 예약 · 일괄 가져오기
-- ----------------------------------------------------------------------------
-- 0066 은 반복 일정을 규칙 하나로만 다뤘다. 그래서 "다음 주 회의만 취소" 나
-- "이번 주만 30분 미루기" 를 할 수 없었다 — 규칙 전체를 바꾸는 수밖에.
--
-- iCalendar 가 쓰는 방식을 그대로 가져온다.
--   * EXDATE  — 그 발생만 없던 것으로 한다(`calendar_event_exceptions`).
--   * 분리(detach) — 그 발생을 단발 일정으로 떼어내고, 원본에는 예외를 남긴다.
--     떼어낸 뒤에는 평범한 일정이므로 기존 편집/삭제가 그대로 통한다.
--
-- 알림은 "언제 보내야 하는가" 를 DB 가 알아야 예약할 수 있는데, 반복 전개는
-- 앱(lib/recurrence.ts)에 있다. 그래서 다음 알림 시각 하나만 컬럼으로 들고
-- (`next_reminder_at`), 발송기가 보낸 뒤 다음 값을 다시 채워 넣는다. DB 는
-- "지금 보낼 것"만 고르면 된다.
-- ============================================================================

-- ---------------------------------------------------------------- 발생 예외
create table public.calendar_event_exceptions (
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  -- 건너뛸 발생의 시작 시각(원 규칙이 만들어 내는 값과 정확히 같아야 한다).
  occurrence_start timestamptz not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, occurrence_start)
);

alter table public.calendar_event_exceptions enable row level security;

create policy calendar_event_exceptions_select on public.calendar_event_exceptions for select
using (public.can_view_event(event_id));

create policy calendar_event_exceptions_insert on public.calendar_event_exceptions for insert
with check (public.can_edit_event(event_id) and created_by = (select auth.uid()));

create policy calendar_event_exceptions_delete on public.calendar_event_exceptions for delete
using (public.can_edit_event(event_id));

-- 떼어낸 일정이 어느 반복에서 나왔는지 — 화면에서 "원래 반복 일정" 을 알려 준다.
alter table public.calendar_events
  add column if not exists detached_from uuid references public.calendar_events(id) on delete set null;

-- 다음에 알림을 보낼 시각. null 이면 보낼 것이 없다.
alter table public.calendar_events
  add column if not exists next_reminder_at timestamptz;

create index calendar_events_next_reminder_idx
  on public.calendar_events (next_reminder_at)
  where next_reminder_at is not null;

-- ----------------------------------------------------------------------------
-- 이 발생만 삭제 — 규칙은 그대로 두고 그 날짜만 뺀다.
-- ----------------------------------------------------------------------------
create or replace function public.delete_event_occurrence(
  p_event uuid,
  p_occurrence_start timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_edit_event(p_event) then
    raise exception 'no permission to edit this event';
  end if;
  if not exists(select 1 from public.calendar_events
                 where id = p_event and recurrence is not null) then
    raise exception 'this event does not repeat';
  end if;

  insert into public.calendar_event_exceptions (event_id, occurrence_start, created_by)
  values (p_event, p_occurrence_start, auth.uid())
  on conflict do nothing;
end;
$$;

revoke all on function public.delete_event_occurrence(uuid, timestamptz) from public, anon;
grant execute on function public.delete_event_occurrence(uuid, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- 이 발생만 분리 — 같은 내용의 단발 일정을 만들고 원본에는 예외를 남긴다.
-- 참석자와 붙인 자료도 함께 복사한다(RSVP 는 초기화된다 — 시간이 바뀔 수 있으니
-- 다시 답하는 것이 맞다).
-- ----------------------------------------------------------------------------
create or replace function public.detach_event_occurrence(
  p_event uuid,
  p_occurrence_start timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.calendar_events%rowtype;
  v_new uuid;
  v_duration interval;
begin
  if not public.can_edit_event(p_event) then
    raise exception 'no permission to edit this event';
  end if;

  select * into v_src from public.calendar_events where id = p_event;
  if not found then
    raise exception 'event not found';
  end if;
  if v_src.recurrence is null then
    raise exception 'this event does not repeat';
  end if;
  if exists(select 1 from public.calendar_event_exceptions
             where event_id = p_event and occurrence_start = p_occurrence_start) then
    raise exception 'that occurrence was already changed or removed';
  end if;

  v_duration := v_src.ends_at - v_src.starts_at;

  insert into public.calendar_events (
    calendar_id, created_by, title, description, location, conference_url,
    starts_at, ends_at, all_day, time_zone, color, recurrence, recurrence_until,
    reminder_minutes, status, busy, repository_id, detached_from
  ) values (
    v_src.calendar_id, v_src.created_by, v_src.title, v_src.description, v_src.location,
    v_src.conference_url, p_occurrence_start, p_occurrence_start + v_duration,
    v_src.all_day, v_src.time_zone, v_src.color, null, null,
    v_src.reminder_minutes, v_src.status, v_src.busy, v_src.repository_id, p_event
  )
  returning id into v_new;

  -- 참석자를 그대로 옮긴다. 주최자 표시는 유지하고 응답은 초기화한다.
  insert into public.calendar_event_attendees (event_id, user_id, response, is_organizer)
  select v_new, a.user_id,
         case when a.is_organizer then 'accepted' else 'needs_action' end,
         a.is_organizer
    from public.calendar_event_attendees a
   where a.event_id = p_event;

  insert into public.calendar_event_links (event_id, object_kind, object_id, added_by)
  select v_new, l.object_kind, l.object_id, auth.uid()
    from public.calendar_event_links l
   where l.event_id = p_event;

  insert into public.calendar_event_exceptions (event_id, occurrence_start, created_by)
  values (p_event, p_occurrence_start, auth.uid())
  on conflict do nothing;

  return v_new;
end;
$$;

revoke all on function public.detach_event_occurrence(uuid, timestamptz) from public, anon;
grant execute on function public.detach_event_occurrence(uuid, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- 조회에 예외 목록을 실어 보낸다 — 화면이 전개할 때 그 발생을 건너뛴다.
-- 반환 컬럼이 늘어나므로 먼저 떨어뜨린다(마이그레이션은 트랜잭션이라 공백 없음).
-- ----------------------------------------------------------------------------
drop function if exists public.list_calendar_events(timestamptz, timestamptz);

create function public.list_calendar_events(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  id uuid,
  calendar_id uuid,
  calendar_name text,
  calendar_color text,
  created_by uuid,
  created_by_name text,
  title text,
  description text,
  location text,
  conference_url text,
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean,
  time_zone text,
  color text,
  recurrence text,
  recurrence_until timestamptz,
  reminder_minutes int,
  status text,
  busy boolean,
  repository_id uuid,
  attendee_count int,
  accepted_count int,
  my_response text,
  is_invited boolean,
  link_count int,
  can_edit boolean,
  exceptions timestamptz[],
  detached_from uuid
)
language sql
security definer
set search_path = public
stable
as $$
  select e.id,
         e.calendar_id,
         c.name,
         c.color,
         e.created_by,
         coalesce(p.display_name, p.email),
         e.title,
         e.description,
         e.location,
         e.conference_url,
         e.starts_at,
         e.ends_at,
         e.all_day,
         e.time_zone,
         e.color,
         e.recurrence,
         e.recurrence_until,
         e.reminder_minutes,
         e.status,
         e.busy,
         e.repository_id,
         (select count(*)::int from public.calendar_event_attendees a where a.event_id = e.id),
         (select count(*)::int from public.calendar_event_attendees a
           where a.event_id = e.id and a.response = 'accepted'),
         (select a.response from public.calendar_event_attendees a
           where a.event_id = e.id and a.user_id = auth.uid()),
         exists(select 1 from public.calendar_event_attendees a
                 where a.event_id = e.id and a.user_id = auth.uid()),
         (select count(*)::int from public.calendar_event_links l where l.event_id = e.id),
         (e.created_by = auth.uid() or public.can_edit_calendar(e.calendar_id)),
         coalesce((select array_agg(x.occurrence_start order by x.occurrence_start)
                     from public.calendar_event_exceptions x where x.event_id = e.id),
                  '{}'::timestamptz[]),
         e.detached_from
    from public.calendar_events e
    join public.calendars c on c.id = e.calendar_id
    join public.profiles p on p.id = e.created_by
   where (public.can_view_calendar(e.calendar_id)
          or exists(select 1 from public.calendar_event_attendees a
                     where a.event_id = e.id and a.user_id = auth.uid()))
     and e.starts_at <= p_to
     and (
       (e.recurrence is null and e.ends_at >= p_from)
       or (e.recurrence is not null
           and (e.recurrence_until is null or e.recurrence_until >= p_from))
     )
   order by e.starts_at;
$$;

revoke all on function public.list_calendar_events(timestamptz, timestamptz) from public, anon;
grant execute on function public.list_calendar_events(timestamptz, timestamptz) to authenticated;

-- get_calendar_event 도 예외 목록을 함께 준다(편집 화면에서 필요).
create or replace function public.get_calendar_event(p_event uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_event jsonb;
begin
  if not public.can_view_event(p_event) then
    return null;
  end if;

  select jsonb_build_object(
    'id', e.id,
    'calendar_id', e.calendar_id,
    'calendar_name', c.name,
    'calendar_color', c.color,
    'created_by', e.created_by,
    'created_by_name', coalesce(p.display_name, p.email),
    'title', e.title,
    'description', e.description,
    'location', e.location,
    'conference_url', e.conference_url,
    'starts_at', e.starts_at,
    'ends_at', e.ends_at,
    'all_day', e.all_day,
    'time_zone', e.time_zone,
    'color', e.color,
    'recurrence', e.recurrence,
    'recurrence_until', e.recurrence_until,
    'reminder_minutes', e.reminder_minutes,
    'status', e.status,
    'busy', e.busy,
    'repository_id', e.repository_id,
    'detached_from', e.detached_from,
    'can_edit', (e.created_by = auth.uid() or public.can_edit_calendar(e.calendar_id)),
    'my_response', (select a.response from public.calendar_event_attendees a
                     where a.event_id = e.id and a.user_id = auth.uid()),
    'attendees', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', a.user_id,
               'name', coalesce(ap.display_name, ap.email),
               'avatar_url', ap.avatar_url,
               'response', a.response,
               'is_organizer', a.is_organizer
             ) order by a.is_organizer desc, coalesce(ap.display_name, ap.email))
        from public.calendar_event_attendees a
        join public.profiles ap on ap.id = a.user_id
       where a.event_id = e.id), '[]'::jsonb),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object('kind', l.object_kind, 'id', l.object_id)
                       order by l.added_at)
        from public.calendar_event_links l
       where l.event_id = e.id), '[]'::jsonb),
    'exceptions', coalesce((
      select jsonb_agg(x.occurrence_start order by x.occurrence_start)
        from public.calendar_event_exceptions x
       where x.event_id = e.id), '[]'::jsonb)
  )
  into v_event
  from public.calendar_events e
  join public.calendars c on c.id = e.calendar_id
  join public.profiles p on p.id = e.created_by
  where e.id = p_event;

  return v_event;
end;
$$;

revoke all on function public.get_calendar_event(uuid) from public, anon;
grant execute on function public.get_calendar_event(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 다음 알림 시각 지정 — 앱이 반복을 전개해 계산한 값을 넣는다.
-- ----------------------------------------------------------------------------
create or replace function public.set_next_reminder(
  p_event uuid,
  p_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_edit_event(p_event) then
    raise exception 'no permission to edit this event';
  end if;
  update public.calendar_events set next_reminder_at = p_at where id = p_event;
end;
$$;

revoke all on function public.set_next_reminder(uuid, timestamptz) from public, anon;
grant execute on function public.set_next_reminder(uuid, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- 발송기용 비밀 — 로그인 없이 도는 배치가 자신을 증명할 유일한 수단.
--
-- Supabase 서비스 롤 키를 앱에 들이지 않기 위한 선택이다. 그 키는 모든 RLS 를
-- 무시하므로, 알림 발송 하나 때문에 배포 환경에 심어 두고 싶지 않다. 대신
-- 이 토큰은 "지금 보낼 알림 목록"만 열어 준다.
-- ----------------------------------------------------------------------------
create table public.app_secrets (
  name text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_secrets enable row level security;
-- 어떤 클라이언트도 직접 못 읽는다. 아래 관리자 전용 RPC 로만.
create policy app_secrets_no_direct_access on public.app_secrets for all using (false);

create or replace function public.get_dispatch_token(p_rotate boolean default false)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
begin
  if not public.is_admin() then
    raise exception 'admins only';
  end if;

  if not p_rotate then
    select value into v_token from public.app_secrets where name = 'notify_dispatch';
    if v_token is not null then
      return v_token;
    end if;
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.app_secrets (name, value)
  values ('notify_dispatch', v_token)
  on conflict (name) do update set value = excluded.value, updated_at = now();

  return v_token;
end;
$$;

revoke all on function public.get_dispatch_token(boolean) from public, anon;
grant execute on function public.get_dispatch_token(boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 보낼 때가 된 알림을 가져온다 — 가져오는 순간 예약을 비워(claim) 두 번 보내지
-- 않는다. 발송기가 다음 발생을 계산해 set_next_reminder_by_token 으로 다시 채운다.
-- ----------------------------------------------------------------------------
create or replace function public.claim_due_event_reminders(
  p_token text,
  p_limit int default 50
)
returns table (
  event_id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean,
  location text,
  time_zone text,
  recurrence text,
  recurrence_until timestamptz,
  reminder_minutes int,
  reminder_at timestamptz,
  exceptions timestamptz[],
  recipients jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
begin
  select value into v_expected from public.app_secrets where name = 'notify_dispatch';
  -- 토큰이 없거나 틀리면 조용히 빈 목록. 어느 쪽인지 알려 주지 않는다.
  if v_expected is null or p_token is null or p_token <> v_expected then
    return;
  end if;

  -- 고른 뒤 곧바로 예약을 비운다. 같은 알림을 두 번 보내지 않기 위해서다.
  -- `for update skip locked` 로 두 발송기가 동시에 돌아도 서로 다른 행만 가져간다.
  -- 데이터 변경 CTE(cleared)는 참조하지 않아도 반드시 한 번 실행된다.
  return query
  with picked as (
    select e.id, e.next_reminder_at as due_at
      from public.calendar_events e
     where e.next_reminder_at is not null
       and e.next_reminder_at <= now()
       and e.status <> 'cancelled'
     order by e.next_reminder_at
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
     for update skip locked
  ),
  cleared as (
    update public.calendar_events e
       set next_reminder_at = null
      from picked pk
     where e.id = pk.id
    returning e.id
  )
  select ev.id,
         ev.title,
         ev.starts_at,
         ev.ends_at,
         ev.all_day,
         ev.location,
         ev.time_zone,
         ev.recurrence,
         ev.recurrence_until,
         ev.reminder_minutes,
         pk.due_at,
         coalesce((select array_agg(x.occurrence_start order by x.occurrence_start)
                     from public.calendar_event_exceptions x where x.event_id = ev.id),
                  '{}'::timestamptz[]),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'user_id', s.user_id,
                    'endpoint', s.endpoint,
                    'p256dh', s.p256dh,
                    'auth', s.auth))
             from public.calendar_event_attendees a
             join public.profiles p on p.id = a.user_id
             join public.push_subscriptions s on s.user_id = a.user_id
            where a.event_id = ev.id
              and a.response <> 'declined'
              and p.push_notifications
         ), '[]'::jsonb)
    from picked pk
    join public.calendar_events ev on ev.id = pk.id;
end;
$$;

revoke all on function public.claim_due_event_reminders(text, int) from public;
grant execute on function public.claim_due_event_reminders(text, int) to anon, authenticated;

-- 발송기가 다음 알림을 다시 예약한다(권한 검사 대신 토큰).
create or replace function public.set_next_reminder_by_token(
  p_token text,
  p_event uuid,
  p_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
begin
  select value into v_expected from public.app_secrets where name = 'notify_dispatch';
  if v_expected is null or p_token is null or p_token <> v_expected then
    return;
  end if;
  update public.calendar_events set next_reminder_at = p_at where id = p_event;
end;
$$;

revoke all on function public.set_next_reminder_by_token(text, uuid, timestamptz) from public;
grant execute on function public.set_next_reminder_by_token(text, uuid, timestamptz) to anon, authenticated;

-- 죽은 구독 정리도 발송기가 해야 한다(로그인 없이 도는 경로).
create or replace function public.prune_push_subscription_by_token(
  p_token text,
  p_endpoint text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
begin
  select value into v_expected from public.app_secrets where name = 'notify_dispatch';
  if v_expected is null or p_token is null or p_token <> v_expected then
    return;
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
end;
$$;

revoke all on function public.prune_push_subscription_by_token(text, text) from public;
grant execute on function public.prune_push_subscription_by_token(text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- .ics 일괄 가져오기 — 일정 하나에 왕복 한 번이면 200개도 버겁다. 한 문장으로.
-- ----------------------------------------------------------------------------
create or replace function public.import_calendar_events(
  p_calendar uuid,
  p_events jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.can_edit_calendar(p_calendar) then
    raise exception 'no permission to add events to this calendar';
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    return 0;
  end if;

  with rows as (
    select
      nullif(btrim(e->>'title'), '') as title,
      (e->>'starts_at')::timestamptz as starts_at,
      (e->>'ends_at')::timestamptz as ends_at,
      coalesce((e->>'all_day')::boolean, false) as all_day,
      nullif(e->>'description', '') as description,
      nullif(e->>'location', '') as location,
      nullif(e->>'conference_url', '') as conference_url,
      nullif(e->>'recurrence', '') as recurrence,
      (e->>'recurrence_until')::timestamptz as recurrence_until,
      coalesce(nullif(e->>'status', ''), 'confirmed') as status
    from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) as e
  ),
  clean as (
    select left(coalesce(title, 'Untitled'), 200) as title,
           starts_at,
           greatest(ends_at, starts_at) as ends_at,
           all_day,
           left(description, 5000) as description,
           left(location, 300) as location,
           case when conference_url ~* '^https?://' then left(conference_url, 500) end as conference_url,
           left(recurrence, 300) as recurrence,
           recurrence_until,
           case when status in ('confirmed', 'tentative', 'cancelled') then status else 'confirmed' end as status
      from rows
     where starts_at is not null and ends_at is not null
  ),
  inserted as (
    insert into public.calendar_events (
      calendar_id, created_by, title, description, location, conference_url,
      starts_at, ends_at, all_day, time_zone, recurrence, recurrence_until, status
    )
    select p_calendar, auth.uid(), title, description, location, conference_url,
           starts_at, ends_at, all_day, 'UTC', recurrence, recurrence_until, status
      from clean
    returning id
  ),
  -- 방금 넣은 것에만 주최자(=가져온 사람)를 참석자로 남긴다. 초대 알림
  -- 트리거는 is_organizer 를 걸러내므로 여기서 알림이 쏟아지지 않는다.
  organiser as (
    insert into public.calendar_event_attendees (event_id, user_id, response, is_organizer)
    select i.id, auth.uid(), 'accepted', true from inserted i
    on conflict do nothing
    returning event_id
  )
  select count(*)::int into v_count from inserted;

  return v_count;
end;
$$;

revoke all on function public.import_calendar_events(uuid, jsonb) from public, anon;
grant execute on function public.import_calendar_events(uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 다가오는 일정도 예외/시간대를 함께 준다 — 대시보드가 같은 규칙으로 전개한다.
-- ----------------------------------------------------------------------------
drop function if exists public.list_upcoming_events(int);

create function public.list_upcoming_events(p_days int default 7)
returns table (
  id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean,
  location text,
  conference_url text,
  color text,
  calendar_color text,
  recurrence text,
  recurrence_until timestamptz,
  my_response text,
  reminder_minutes int,
  time_zone text,
  exceptions timestamptz[]
)
language sql
security definer
set search_path = public
stable
as $$
  select e.id, e.title, e.starts_at, e.ends_at, e.all_day, e.location, e.conference_url,
         e.color, c.color, e.recurrence, e.recurrence_until,
         (select a.response from public.calendar_event_attendees a
           where a.event_id = e.id and a.user_id = auth.uid()),
         e.reminder_minutes,
         e.time_zone,
         coalesce((select array_agg(x.occurrence_start order by x.occurrence_start)
                     from public.calendar_event_exceptions x where x.event_id = e.id),
                  '{}'::timestamptz[])
    from public.calendar_events e
    join public.calendars c on c.id = e.calendar_id
   where e.status <> 'cancelled'
     and (public.can_view_calendar(e.calendar_id)
          or exists(select 1 from public.calendar_event_attendees a
                     where a.event_id = e.id and a.user_id = auth.uid()))
     and e.starts_at <= now() + make_interval(days => greatest(coalesce(p_days, 7), 1))
     and (
       (e.recurrence is null and e.ends_at >= now())
       or (e.recurrence is not null
           and (e.recurrence_until is null or e.recurrence_until >= now()))
     )
   order by e.starts_at
   limit 100;
$$;

revoke all on function public.list_upcoming_events(int) from public, anon;
grant execute on function public.list_upcoming_events(int) to authenticated;
