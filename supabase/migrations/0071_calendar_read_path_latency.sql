-- ============================================================================
-- 캘린더 읽기 경로의 꼬리 지연 제거.
--
-- 측정(50명·일정 6,000·참석자 24,000 의 데이터로 authenticated 롤로 실행):
--   list_calendar_events(한 달)  p50 139 ms · 376행에 shared buffer 25,405
--   list_upcoming_events(7일)    p50 105 ms
-- 376행을 돌려주는 데 버퍼를 25,000번 넘게 만졌다. 행당 68번이다.
--
-- 원인은 두 가지이고 둘 다 "행마다 다시 한다" 이다.
--
--  1) 권한 판정이 행마다 함수 호출이었다.
--     where 절의 can_view_calendar(e.calendar_id) 는 SECURITY DEFINER 함수라
--     플래너가 안을 들여다볼 수 없다(인라인 불가). 그래서 이 조건으로 행을
--     미리 줄이지 못하고, calendar_events 를 통째로 훑으면서 행마다 함수를
--     부른다 — (calendar_id, starts_at) 인덱스가 있는데도 쓰이지 않는다.
--     달력 수는 사람당 기껏해야 수십 개다. **먼저 한 번** 구해 놓고 그 목록으로
--     인덱스를 타면 될 일이었다.
--
--  2) 같은 테이블을 행마다 네 번 훑었다.
--     attendee_count / accepted_count / my_response / is_invited 가 각각 별개의
--     상관 서브쿼리라, 일정 하나마다 calendar_event_attendees 를 네 번 들여다
--     본다. 한 번 훑어 네 값을 같이 계산하면 된다(LATERAL 한 번).
--
-- 왜 p50 보다 꼬리에서 더 중요한가: 이 비용은 "범위 안의 일정 수" 에 비례한다.
-- 달력을 여러 개 공유받은 사람일수록 행이 많고, 그 사람이 바로 p99·p999 에
-- 앉아 있는 사용자다. 즉 이 구조는 꼬리를 사용자 편차만큼 증폭시킨다.
--
-- 동작(반환 값)은 바뀌지 않는다. can_view_calendar/can_edit_calendar 의 논리를
-- 그대로 옮겨 적었을 뿐이다 — 이 함수들은 이미 SECURITY DEFINER 라 같은 권한
-- 으로 도는 것이 보장된다.
-- ============================================================================

create or replace function public.list_calendar_events(
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
  -- 나와 관리자 여부는 쿼리당 한 번만.
  with me as (
    select auth.uid() as uid, public.is_admin() as is_admin
  ),
  -- 내가 볼 수 있는 달력과, 그중 고칠 수 있는 달력. can_view_calendar /
  -- can_edit_calendar 와 같은 논리를 한 번에 집합으로 만든다.
  cal as (
    select c.id, c.name, c.color,
           (m.is_admin or c.owner_id = m.uid or mem.role = 'editor') as editable
      from public.calendars c
      cross join me m
      left join public.calendar_members mem
             on mem.calendar_id = c.id and mem.user_id = m.uid
     where m.is_admin or c.owner_id = m.uid or mem.user_id is not null
  ),
  -- 내가 초대받은 일정 — 달력을 공유받지 않았어도 보여야 한다.
  invited as (
    select a.event_id from public.calendar_event_attendees a, me m
     where a.user_id = m.uid
  ),
  ev as (
    select e.*
      from public.calendar_events e
     where e.starts_at <= p_to
       and (
         (e.recurrence is null and e.ends_at >= p_from)
         or (e.recurrence is not null
             and (e.recurrence_until is null or e.recurrence_until >= p_from))
       )
       and (e.calendar_id in (select id from cal)
            or e.id in (select event_id from invited))
  )
  select e.id,
         e.calendar_id,
         -- 이름·색은 반드시 달력 자체에서 읽는다. cal 은 "내가 접근 권한을
         -- 가진 달력" 집합이라, 달력은 공유받지 않고 **일정에만 초대된** 경우
         -- 비어 있다. 거기서 읽으면 그 일정들의 달력 이름이 통째로 NULL 이 된다.
         c0.name,
         c0.color,
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
         att.total,
         att.accepted,
         att.my_response,
         att.is_invited,
         lk.n,
         (e.created_by = (select uid from me) or coalesce(cal.editable, false)),
         coalesce(ex.list, '{}'::timestamptz[]),
         e.detached_from
    from ev e
    -- c0: 표시용(이름·색). cal: 권한용 — 초대만 받은 일정에서는 비어 있다.
    join public.calendars c0 on c0.id = e.calendar_id
    left join cal on cal.id = e.calendar_id
    join public.profiles p on p.id = e.created_by
    -- 참석자 통계는 한 번만 훑는다(전에는 행마다 네 번이었다).
    left join lateral (
      select count(*)::int as total,
             count(*) filter (where a.response = 'accepted')::int as accepted,
             max(a.response) filter (where a.user_id = (select uid from me)) as my_response,
             coalesce(bool_or(a.user_id = (select uid from me)), false) as is_invited
        from public.calendar_event_attendees a
       where a.event_id = e.id
    ) att on true
    left join lateral (
      select count(*)::int as n
        from public.calendar_event_links l where l.event_id = e.id
    ) lk on true
    left join lateral (
      select array_agg(x.occurrence_start order by x.occurrence_start) as list
        from public.calendar_event_exceptions x where x.event_id = e.id
    ) ex on true
   order by e.starts_at;
$$;

revoke all on function public.list_calendar_events(timestamptz, timestamptz) from public, anon;
grant execute on function public.list_calendar_events(timestamptz, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- 대시보드의 "UP NEXT" — 같은 병을 앓고 있었다. 여기는 limit 100 이 붙어 있어
-- 결과는 작지만, 그 100개를 고르려고 전체를 훑는 것은 똑같다.
-- ----------------------------------------------------------------------------
create or replace function public.list_upcoming_events(p_days int default 7)
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
  with me as (
    select auth.uid() as uid, public.is_admin() as is_admin
  ),
  cal as (
    select c.id
      from public.calendars c
      cross join me m
      left join public.calendar_members mem
             on mem.calendar_id = c.id and mem.user_id = m.uid
     where m.is_admin or c.owner_id = m.uid or mem.user_id is not null
  ),
  invited as (
    select a.event_id from public.calendar_event_attendees a, me m
     where a.user_id = m.uid
  ),
  ev as (
    select e.*
      from public.calendar_events e
     where e.status <> 'cancelled'
       and e.starts_at <= now() + make_interval(days => greatest(coalesce(p_days, 7), 1))
       and (
         (e.recurrence is null and e.ends_at >= now())
         or (e.recurrence is not null
             and (e.recurrence_until is null or e.recurrence_until >= now()))
       )
       and (e.calendar_id in (select id from cal)
            or e.id in (select event_id from invited))
     order by e.starts_at
     limit 100
  )
  select e.id, e.title, e.starts_at, e.ends_at, e.all_day, e.location, e.conference_url,
         e.color, c.color, e.recurrence, e.recurrence_until,
         mine.response,
         e.reminder_minutes,
         e.time_zone,
         coalesce(ex.list, '{}'::timestamptz[])
    from ev e
    join public.calendars c on c.id = e.calendar_id
    left join lateral (
      select a.response from public.calendar_event_attendees a
       where a.event_id = e.id and a.user_id = (select uid from me)
    ) mine on true
    left join lateral (
      select array_agg(x.occurrence_start order by x.occurrence_start) as list
        from public.calendar_event_exceptions x where x.event_id = e.id
    ) ex on true
   order by e.starts_at;
$$;

revoke all on function public.list_upcoming_events(int) from public, anon;
grant execute on function public.list_upcoming_events(int) to authenticated;

-- ----------------------------------------------------------------------------
-- 인덱스: 초대받은 일정을 뒤집어 찾는 경로(event_id → user_id 가 아니라
-- user_id → event_id)는 이미 calendar_event_attendees_user_idx 가 있다.
-- 없던 것은 "취소되지 않은 다가오는 일정" 의 시간순 진입점이다.
-- ----------------------------------------------------------------------------
create index if not exists calendar_events_starts_idx
  on public.calendar_events (starts_at)
  where status <> 'cancelled';
