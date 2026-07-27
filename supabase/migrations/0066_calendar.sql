-- ============================================================================
-- Calendar — 일정 공유
-- ----------------------------------------------------------------------------
-- 참고한 것과 무엇을 가져왔는지:
--   * Google/Apple Calendar — "달력(calendar)" 이라는 그릇을 여러 개 두고 색으로
--     구분하며, 달력 단위로 공유하고, RRULE 로 반복을 표현하고, ICS 로 주고받는다.
--   * Microsoft Teams / Outlook — 참석자(attendee)와 응답(RSVP: 수락/거절/미정),
--     그리고 "바쁨(busy)/한가함(free)" 구분.
--   * Slack — 알림이 채팅으로 온다. 일정 자체가 대화 안에서 유통된다.
--   * Evernote/Notion — 일정에 문서·파일을 붙여 둔다. 회의에 들어가기 전에
--     읽을 것이 그 자리에 있어야 한다.
-- Possion 이 이미 가진 것(문서·시트·코드·링크그래프·파일·채팅·저장소)과
-- 겹치는 부분은 새로 만들지 않고 연결한다 — calendar_event_links 가 그 접점이다.
--
-- 구조는 4테이블:
--   calendars                내 달력 / 공유받은 달력
--   calendar_members         달력 공유(viewer|editor)
--   calendar_events          일정 본체(반복 규칙은 문자열로 저장, 전개는 앱에서)
--   calendar_event_attendees 참석자 + RSVP
--   calendar_event_links     일정 ↔ Possion 오브젝트 연결
--
-- RLS 재귀 회피: chat_* (0040) 와 같은 방식으로 멤버십/권한 판정을 전부
-- SECURITY DEFINER 헬퍼(can_view_calendar / can_edit_calendar / can_view_event /
-- can_edit_event) 하나로 모으고, 정책은 그 함수만 부른다.
--
-- 반복 일정을 SQL 에서 전개하지 않는 이유: 개별 발생을 행으로 만들면 "이번 것만
-- 수정" 과 무한 반복이 곧바로 문제가 된다. 규칙만 저장하고 조회 범위 안에서
-- 앱(lib/recurrence.ts)이 전개한다 — 순수 함수라 테스트도 쉽다.
-- ============================================================================

-- ---------------------------------------------------------------- 달력
create table public.calendars (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  -- 화면 표시색. 검증해두지 않으면 임의 문자열이 style 로 들어간다.
  color text not null default '#3b82f6' check (color ~ '^#[0-9a-fA-F]{6}$'),
  -- 로그인 후 처음 열 때 자동으로 만들어지는 기본 달력.
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index calendars_owner_idx on public.calendars (owner_id, created_at);
-- 기본 달력은 사람당 하나.
create unique index calendars_one_default_idx
  on public.calendars (owner_id) where is_default;

create trigger calendars_set_updated_at
before update on public.calendars
for each row execute function public.set_updated_at();

create table public.calendar_members (
  calendar_id uuid not null references public.calendars(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'viewer' check (role in ('viewer', 'editor')),
  added_by uuid not null references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (calendar_id, user_id)
);
create index calendar_members_user_idx on public.calendar_members (user_id);

-- ---------------------------------------------------------------- 일정
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.calendars(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text check (description is null or char_length(description) <= 5000),
  location text check (location is null or char_length(location) <= 300),
  -- 화상회의 링크(Teams/Meet/Zoom 등 무엇이든). 앱에서 http(s) 만 허용한다.
  conference_url text check (conference_url is null or char_length(conference_url) <= 500),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  -- 만든 사람의 시간대. 표시는 보는 사람의 시간대로 하되, 반복 일정의
  -- "매주 화요일 09:00" 이 서머타임/시차로 밀리지 않게 원 시간대를 남긴다.
  time_zone text not null default 'UTC' check (char_length(time_zone) <= 64),
  -- 달력 색을 따르면 null.
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  -- RRULE 축약: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY;INTERVAL=n;BYDAY=MO,TU;COUNT=n
  recurrence text check (recurrence is null or char_length(recurrence) <= 300),
  recurrence_until timestamptz,
  -- 시작 몇 분 전에 알릴지. null 이면 알리지 않는다.
  reminder_minutes int check (reminder_minutes is null or reminder_minutes between 0 and 40320),
  status text not null default 'confirmed' check (status in ('confirmed', 'tentative', 'cancelled')),
  -- 바쁨/한가함 — 남이 내 일정을 볼 때의 표시(Outlook 의 show-as).
  busy boolean not null default true,
  repository_id uuid references public.repositories(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_events_time_order check (ends_at >= starts_at)
);
create index calendar_events_calendar_range_idx
  on public.calendar_events (calendar_id, starts_at, ends_at);
create index calendar_events_recurring_idx
  on public.calendar_events (calendar_id, starts_at) where recurrence is not null;
create index calendar_events_repository_idx on public.calendar_events (repository_id);

create trigger calendar_events_set_updated_at
before update on public.calendar_events
for each row execute function public.set_updated_at();

create table public.calendar_event_attendees (
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  response text not null default 'needs_action'
    check (response in ('needs_action', 'accepted', 'declined', 'tentative')),
  is_organizer boolean not null default false,
  invited_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (event_id, user_id)
);
create index calendar_event_attendees_user_idx
  on public.calendar_event_attendees (user_id, event_id);

-- 일정에 붙는 Possion 오브젝트(문서/시트/코드/링크그래프/파일).
create table public.calendar_event_links (
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  object_kind text not null check (object_kind in ('document', 'code', 'sheet', 'mindmap', 'file')),
  object_id uuid not null,
  added_by uuid not null references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (event_id, object_kind, object_id)
);

-- ----------------------------------------------------------------------------
-- 권한 판정 헬퍼 — 정책은 전부 여기로만 위임한다(상호 재귀 차단).
-- ----------------------------------------------------------------------------
create or replace function public.can_view_calendar(p_calendar uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(
    select 1 from public.calendars c
    where c.id = p_calendar
      and (c.owner_id = auth.uid()
           or exists(select 1 from public.calendar_members m
                      where m.calendar_id = c.id and m.user_id = auth.uid())
           or public.is_admin())
  );
$$;

create or replace function public.can_edit_calendar(p_calendar uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(
    select 1 from public.calendars c
    where c.id = p_calendar
      and (c.owner_id = auth.uid()
           or exists(select 1 from public.calendar_members m
                      where m.calendar_id = c.id and m.user_id = auth.uid() and m.role = 'editor')
           or public.is_admin())
  );
$$;

-- 참석자로 초대받았다면 그 달력을 못 봐도 그 일정은 봐야 한다 — 초대의 의미가
-- 그것이다.
create or replace function public.can_view_event(p_event uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(
    select 1 from public.calendar_events e
    where e.id = p_event
      and (public.can_view_calendar(e.calendar_id)
           or exists(select 1 from public.calendar_event_attendees a
                      where a.event_id = e.id and a.user_id = auth.uid()))
  );
$$;

-- 고칠 수 있는 사람: 만든 사람, 그 달력의 편집자, 관리자. 참석자는 자기 응답만
-- 바꿀 수 있다(respond_to_event).
create or replace function public.can_edit_event(p_event uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(
    select 1 from public.calendar_events e
    where e.id = p_event
      and (e.created_by = auth.uid() or public.can_edit_calendar(e.calendar_id))
  );
$$;

revoke all on function public.can_view_calendar(uuid) from public, anon;
revoke all on function public.can_edit_calendar(uuid) from public, anon;
revoke all on function public.can_view_event(uuid) from public, anon;
revoke all on function public.can_edit_event(uuid) from public, anon;
grant execute on function public.can_view_calendar(uuid) to authenticated;
grant execute on function public.can_edit_calendar(uuid) to authenticated;
grant execute on function public.can_view_event(uuid) to authenticated;
grant execute on function public.can_edit_event(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.calendars enable row level security;
alter table public.calendar_members enable row level security;
alter table public.calendar_events enable row level security;
alter table public.calendar_event_attendees enable row level security;
alter table public.calendar_event_links enable row level security;

create policy calendars_select on public.calendars for select
using (public.can_view_calendar(id));

create policy calendars_insert on public.calendars for insert
with check (owner_id = (select auth.uid()));

create policy calendars_update on public.calendars for update
using (owner_id = (select auth.uid()) or public.is_admin());

create policy calendars_delete on public.calendars for delete
using (owner_id = (select auth.uid()) or public.is_admin());

create policy calendar_members_select on public.calendar_members for select
using (public.can_view_calendar(calendar_id) or user_id = (select auth.uid()));

-- 공유 추가/변경은 소유자만(아래 share_calendar RPC 를 통해서도 동일 규칙).
create policy calendar_members_insert on public.calendar_members for insert
with check (exists(select 1 from public.calendars c
                    where c.id = calendar_id and c.owner_id = (select auth.uid())));

create policy calendar_members_update on public.calendar_members for update
using (exists(select 1 from public.calendars c
               where c.id = calendar_id and c.owner_id = (select auth.uid())));

-- 소유자는 회수할 수 있고, 공유받은 사람은 스스로 빠질 수 있다.
create policy calendar_members_delete on public.calendar_members for delete
using (user_id = (select auth.uid())
       or exists(select 1 from public.calendars c
                  where c.id = calendar_id and c.owner_id = (select auth.uid()))
       or public.is_admin());

create policy calendar_events_select on public.calendar_events for select
using (public.can_view_calendar(calendar_id)
       or exists(select 1 from public.calendar_event_attendees a
                  where a.event_id = id and a.user_id = (select auth.uid())));

create policy calendar_events_insert on public.calendar_events for insert
with check (created_by = (select auth.uid()) and public.can_edit_calendar(calendar_id));

create policy calendar_events_update on public.calendar_events for update
using (created_by = (select auth.uid()) or public.can_edit_calendar(calendar_id));

create policy calendar_events_delete on public.calendar_events for delete
using (created_by = (select auth.uid()) or public.can_edit_calendar(calendar_id));

create policy calendar_event_attendees_select on public.calendar_event_attendees for select
using (public.can_view_event(event_id));

create policy calendar_event_attendees_insert on public.calendar_event_attendees for insert
with check (public.can_edit_event(event_id));

-- 자기 응답(RSVP)은 자기가, 나머지는 주최 쪽이.
create policy calendar_event_attendees_update on public.calendar_event_attendees for update
using (user_id = (select auth.uid()) or public.can_edit_event(event_id));

create policy calendar_event_attendees_delete on public.calendar_event_attendees for delete
using (user_id = (select auth.uid()) or public.can_edit_event(event_id));

create policy calendar_event_links_select on public.calendar_event_links for select
using (public.can_view_event(event_id));

-- 붙이려는 자료를 볼 수 있어야 붙일 수 있다.
create policy calendar_event_links_insert on public.calendar_event_links for insert
with check (public.can_edit_event(event_id)
            and added_by = (select auth.uid())
            and public.can_view_object(object_kind, object_id));

create policy calendar_event_links_delete on public.calendar_event_links for delete
using (public.can_edit_event(event_id));

-- ----------------------------------------------------------------------------
-- 기본 달력 — 처음 /calendar 를 열 때 하나 만들어 준다.
-- ----------------------------------------------------------------------------
create or replace function public.ensure_default_calendar()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select id into v_id from public.calendars
   where owner_id = auth.uid() and is_default
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  select coalesce(display_name, split_part(email, '@', 1)) into v_name
    from public.profiles where id = auth.uid();

  insert into public.calendars (owner_id, name, color, is_default)
  values (auth.uid(), coalesce(nullif(v_name, ''), 'My') || '''s calendar', '#3b82f6', true)
  -- 두 탭이 동시에 열리면 둘 다 INSERT 를 시도한다. 부분 유니크 인덱스가
  -- 한쪽을 막으므로 조용히 넘기고 아래에서 다시 읽는다.
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.calendars
     where owner_id = auth.uid() and is_default limit 1;
  end if;

  return v_id;
end;
$$;

revoke all on function public.ensure_default_calendar() from public, anon;
grant execute on function public.ensure_default_calendar() to authenticated;

-- ----------------------------------------------------------------------------
-- 내 달력 + 공유받은 달력
-- ----------------------------------------------------------------------------
create or replace function public.list_calendars()
returns table (
  id uuid,
  name text,
  description text,
  color text,
  is_default boolean,
  owner_id uuid,
  owner_name text,
  my_role text,
  member_count int,
  event_count int
)
language sql
security definer
set search_path = public
stable
as $$
  select c.id,
         c.name,
         c.description,
         c.color,
         c.is_default,
         c.owner_id,
         coalesce(p.display_name, p.email) as owner_name,
         case when c.owner_id = auth.uid() then 'owner'
              else coalesce((select m.role from public.calendar_members m
                              where m.calendar_id = c.id and m.user_id = auth.uid()), 'viewer')
         end as my_role,
         (select count(*)::int from public.calendar_members m where m.calendar_id = c.id) as member_count,
         (select count(*)::int from public.calendar_events e where e.calendar_id = c.id) as event_count
    from public.calendars c
    join public.profiles p on p.id = c.owner_id
   where c.owner_id = auth.uid()
      or exists(select 1 from public.calendar_members m
                 where m.calendar_id = c.id and m.user_id = auth.uid())
   order by (c.owner_id = auth.uid()) desc, c.is_default desc, c.name;
$$;

revoke all on function public.list_calendars() from public, anon;
grant execute on function public.list_calendars() to authenticated;

-- ----------------------------------------------------------------------------
-- 범위 안의 일정 — 반복 일정은 "규칙이 이 범위에 닿을 수 있는가" 로만 거른다.
-- 실제 발생일 전개는 앱(lib/recurrence.ts)이 한다.
-- 초대받은 일정은 그 달력을 못 봐도 함께 나온다.
-- ----------------------------------------------------------------------------
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
  can_edit boolean
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
         (e.created_by = auth.uid() or public.can_edit_calendar(e.calendar_id))
    from public.calendar_events e
    join public.calendars c on c.id = e.calendar_id
    join public.profiles p on p.id = e.created_by
   where (public.can_view_calendar(e.calendar_id)
          or exists(select 1 from public.calendar_event_attendees a
                     where a.event_id = e.id and a.user_id = auth.uid()))
     and e.starts_at <= p_to
     and (
       -- 단발 일정: 범위와 겹치면 된다.
       (e.recurrence is null and e.ends_at >= p_from)
       -- 반복 일정: 규칙이 끝나기 전이면 후보다(정확한 발생일은 앱이 계산).
       or (e.recurrence is not null
           and (e.recurrence_until is null or e.recurrence_until >= p_from))
     )
   order by e.starts_at;
$$;

revoke all on function public.list_calendar_events(timestamptz, timestamptz) from public, anon;
grant execute on function public.list_calendar_events(timestamptz, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- 일정 하나의 상세 — 참석자와 붙어 있는 자료까지.
-- ----------------------------------------------------------------------------
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
       where l.event_id = e.id), '[]'::jsonb)
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
-- 저장(생성/수정) — 참석자 명단을 통째로 받아 맞춘다.
-- 참석자 테이블을 앱에서 직접 다루면 "추가만 되고 삭제는 안 되는" 상태가 쉽게
-- 생기므로, 한 번의 호출로 명단 전체를 확정한다. 이미 응답한 사람의 응답은
-- 보존한다(수정 때마다 RSVP 가 초기화되면 아무도 안 쓴다).
-- ----------------------------------------------------------------------------
create or replace function public.save_calendar_event(
  p_id uuid,
  p_calendar uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_all_day boolean default false,
  p_description text default null,
  p_location text default null,
  p_conference_url text default null,
  p_time_zone text default 'UTC',
  p_color text default null,
  p_recurrence text default null,
  p_recurrence_until timestamptz default null,
  p_reminder_minutes int default null,
  p_status text default 'confirmed',
  p_busy boolean default true,
  p_repository uuid default null,
  p_attendees uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := p_id;
  v_attendees uuid[] := coalesce(p_attendees, '{}');
  v_organizer uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_ends_at < p_starts_at then
    raise exception 'end must not be before start';
  end if;

  if v_id is null then
    if not public.can_edit_calendar(p_calendar) then
      raise exception 'no permission to add events to this calendar';
    end if;
    insert into public.calendar_events (
      calendar_id, created_by, title, description, location, conference_url,
      starts_at, ends_at, all_day, time_zone, color, recurrence, recurrence_until,
      reminder_minutes, status, busy, repository_id
    ) values (
      p_calendar, auth.uid(), p_title, p_description, p_location, p_conference_url,
      p_starts_at, p_ends_at, coalesce(p_all_day, false), coalesce(p_time_zone, 'UTC'),
      p_color, nullif(btrim(coalesce(p_recurrence, '')), ''), p_recurrence_until,
      p_reminder_minutes, coalesce(p_status, 'confirmed'), coalesce(p_busy, true), p_repository
    )
    returning id into v_id;
    v_organizer := auth.uid();
  else
    if not public.can_edit_event(v_id) then
      raise exception 'no permission to edit this event';
    end if;
    -- 달력을 옮기는 경우, 옮겨 갈 달력에도 쓸 수 있어야 한다.
    if p_calendar is distinct from (select calendar_id from public.calendar_events where id = v_id)
       and not public.can_edit_calendar(p_calendar) then
      raise exception 'no permission to move the event to that calendar';
    end if;
    update public.calendar_events set
      calendar_id = p_calendar,
      title = p_title,
      description = p_description,
      location = p_location,
      conference_url = p_conference_url,
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      all_day = coalesce(p_all_day, false),
      time_zone = coalesce(p_time_zone, 'UTC'),
      color = p_color,
      recurrence = nullif(btrim(coalesce(p_recurrence, '')), ''),
      recurrence_until = p_recurrence_until,
      reminder_minutes = p_reminder_minutes,
      status = coalesce(p_status, 'confirmed'),
      busy = coalesce(p_busy, true),
      repository_id = p_repository
    where id = v_id;
    select created_by into v_organizer from public.calendar_events where id = v_id;
  end if;

  -- 참석자 맞추기. 주최자는 명단에 없어도 항상 참석자로 남는다.
  delete from public.calendar_event_attendees a
   where a.event_id = v_id
     and a.user_id <> v_organizer
     and not (a.user_id = any(v_attendees));

  insert into public.calendar_event_attendees (event_id, user_id, response, is_organizer)
  select v_id, u, 'needs_action', false
    from unnest(v_attendees) as u
   where u <> v_organizer
  on conflict (event_id, user_id) do nothing;

  insert into public.calendar_event_attendees (event_id, user_id, response, is_organizer)
  values (v_id, v_organizer, 'accepted', true)
  on conflict (event_id, user_id) do update set is_organizer = true;

  return v_id;
end;
$$;

revoke all on function public.save_calendar_event(
  uuid, uuid, text, timestamptz, timestamptz, boolean, text, text, text, text, text,
  text, timestamptz, int, text, boolean, uuid, uuid[]
) from public, anon;
grant execute on function public.save_calendar_event(
  uuid, uuid, text, timestamptz, timestamptz, boolean, text, text, text, text, text,
  text, timestamptz, int, text, boolean, uuid, uuid[]
) to authenticated;

-- ----------------------------------------------------------------------------
-- RSVP — 참석자 본인만.
-- ----------------------------------------------------------------------------
create or replace function public.respond_to_event(p_event uuid, p_response text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_response not in ('accepted', 'declined', 'tentative', 'needs_action') then
    raise exception 'invalid response';
  end if;
  update public.calendar_event_attendees
     set response = p_response, responded_at = now()
   where event_id = p_event and user_id = auth.uid();
  if not found then
    raise exception 'you are not invited to this event';
  end if;
end;
$$;

revoke all on function public.respond_to_event(uuid, text) from public, anon;
grant execute on function public.respond_to_event(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 달력 공유 — 소유자만. 상대가 존재하지 않으면 FK 가 막는다.
-- ----------------------------------------------------------------------------
create or replace function public.share_calendar(
  p_calendar uuid,
  p_user uuid,
  p_role text default 'viewer'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_role not in ('viewer', 'editor') then
    raise exception 'role must be viewer or editor';
  end if;
  if not exists(select 1 from public.calendars
                 where id = p_calendar and owner_id = auth.uid()) then
    raise exception 'only the calendar owner can share it';
  end if;
  if p_user = auth.uid() then
    raise exception 'you already own this calendar';
  end if;

  insert into public.calendar_members (calendar_id, user_id, role, added_by)
  values (p_calendar, p_user, p_role, auth.uid())
  on conflict (calendar_id, user_id) do update set role = excluded.role;
end;
$$;

revoke all on function public.share_calendar(uuid, uuid, text) from public, anon;
grant execute on function public.share_calendar(uuid, uuid, text) to authenticated;

create or replace function public.list_calendar_members(p_calendar uuid)
returns table (user_id uuid, name text, avatar_url text, role text, added_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select m.user_id,
         coalesce(p.display_name, p.email),
         p.avatar_url,
         m.role,
         m.added_at
    from public.calendar_members m
    join public.profiles p on p.id = m.user_id
   where m.calendar_id = p_calendar
     and public.can_view_calendar(p_calendar)
   order by coalesce(p.display_name, p.email);
$$;

revoke all on function public.list_calendar_members(uuid) from public, anon;
grant execute on function public.list_calendar_members(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 일정 ↔ 자료 연결. 붙이려는 자료를 볼 수 있어야 하고, 일정은 고칠 수 있어야
-- 한다 — 두 조건 다 RLS 의 insert 정책이 이미 강제하므로 여기서는 얇게 감싼다.
-- ----------------------------------------------------------------------------
create or replace function public.link_event_object(
  p_event uuid,
  p_kind text,
  p_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind not in ('document', 'code', 'sheet', 'mindmap', 'file') then
    raise exception 'unsupported object kind';
  end if;
  if not public.can_edit_event(p_event) then
    raise exception 'no permission to edit this event';
  end if;
  if not public.can_view_object(p_kind, p_id) then
    raise exception 'object not visible';
  end if;

  insert into public.calendar_event_links (event_id, object_kind, object_id, added_by)
  values (p_event, p_kind, p_id, auth.uid())
  on conflict do nothing;
end;
$$;

create or replace function public.unlink_event_object(
  p_event uuid,
  p_kind text,
  p_id uuid
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
  delete from public.calendar_event_links
   where event_id = p_event and object_kind = p_kind and object_id = p_id;
end;
$$;

revoke all on function public.link_event_object(uuid, text, uuid) from public, anon;
revoke all on function public.unlink_event_object(uuid, text, uuid) from public, anon;
grant execute on function public.link_event_object(uuid, text, uuid) to authenticated;
grant execute on function public.unlink_event_object(uuid, text, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 삭제 — 고칠 수 있는 사람만. 참석자·연결은 cascade 로 함께 지워진다.
-- ----------------------------------------------------------------------------
create or replace function public.delete_calendar_event(p_event uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_edit_event(p_event) then
    raise exception 'no permission to delete this event';
  end if;
  delete from public.calendar_events where id = p_event;
end;
$$;

revoke all on function public.delete_calendar_event(uuid) from public, anon;
grant execute on function public.delete_calendar_event(uuid) to authenticated;
