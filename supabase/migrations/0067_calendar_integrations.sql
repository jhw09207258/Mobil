-- ============================================================================
-- Calendar 연결 — 채팅 · 실시간 · 초대 알림 · 외부 달력 구독(ICS)
-- ----------------------------------------------------------------------------
-- 0066 이 일정을 저장한다면, 여기서는 그 일정이 앱 안팎을 돌아다니게 만든다.
--   1) 채팅 첨부 칩에 'event' 종류를 추가한다(get_object_cards 확장).
--   2) 첨부 후보 목록에도 일정을 넣는다(list_attachable_objects 확장).
--   3) `calendar:<uuid>` 토픽을 실시간 인가에 추가 — 공유 달력을 함께 보고
--      있을 때 다른 사람의 수정이 바로 반영된다.
--   4) 초대받으면 개인 알림 토픽(`user:<id>`)으로 알린다. 채팅 새 메시지와
--      같은 경로라 클라이언트가 이미 구독하고 있다.
--   5) ICS 구독 주소 — Google/Apple 캘린더가 Possion 일정을 읽어 가게 한다.
--      로그인 없이 불리는 경로이므로 토큰(32바이트) 하나로만 인증하고,
--      그 토큰이 가리키는 사람이 "볼 수 있는" 일정만 내보낸다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) 첨부 카드에 일정 추가
-- ----------------------------------------------------------------------------
create or replace function public.get_object_cards(p_refs jsonb)
returns table (
  kind text,
  id uuid,
  title text,
  subtitle text,
  owner_id uuid,
  owner_name text,
  updated_at timestamptz,
  size_bytes bigint,
  mime_type text,
  can_view boolean,
  can_edit boolean,
  object_exists boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ref jsonb;
  v_kind text;
  v_id uuid;
  v_seen text[] := '{}';
  v_key text;
  v_deleted timestamptz;
  v_starts timestamptz;
begin
  if p_refs is null or jsonb_typeof(p_refs) <> 'array' then
    return;
  end if;

  for v_ref in select * from jsonb_array_elements(p_refs) loop
    v_kind := v_ref->>'kind';
    begin
      v_id := (v_ref->>'id')::uuid;
    exception when others then
      continue;
    end;
    if v_kind is null or v_id is null then continue; end if;

    v_key := v_kind || ':' || v_id::text;
    if v_key = any(v_seen) then continue; end if;
    v_seen := v_seen || v_key;
    if array_length(v_seen, 1) > 200 then return; end if;

    kind := v_kind;
    id := v_id;
    title := null; subtitle := null;
    owner_id := null; owner_name := null;
    updated_at := null; size_bytes := null; mime_type := null;
    object_exists := true;
    v_deleted := null;

    if v_kind = 'event' then
      -- 일정은 can_view_object 의 5종에 없다 — 전용 판정을 쓴다.
      can_view := public.can_view_event(v_id);
      can_edit := case when can_view then public.can_edit_event(v_id) else false end;
      select e.title, e.updated_at, e.created_by, e.starts_at
        into title, updated_at, owner_id, v_starts
        from public.calendar_events e where e.id = v_id;
      if owner_id is null then
        object_exists := false;
        can_view := false; can_edit := false;
        title := null;
      else
        select coalesce(p.display_name, p.email) into owner_name
          from public.profiles p where p.id = owner_id;
        if can_view then
          -- 카드 부제로 시작 시각을 ISO 로 넘긴다. 표시 형식은 보는 사람의
          -- 시간대에 맞춰 앱이 정한다.
          subtitle := to_char(v_starts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
        else
          title := null;
        end if;
      end if;
      return next;
      continue;
    end if;

    can_view := public.can_view_object(v_kind, v_id);
    can_edit := case when can_view then public.can_edit_object(v_kind, v_id) else false end;

    if v_kind = 'document' then
      select d.title, d.updated_at, d.owner_id, d.deleted_at
        into title, updated_at, owner_id, v_deleted
        from public.documents d where d.id = v_id;
    elsif v_kind = 'code' then
      select c.name, c.updated_at, c.owner_id, c.language, c.deleted_at
        into title, updated_at, owner_id, subtitle, v_deleted
        from public.code_files c where c.id = v_id;
    elsif v_kind = 'sheet' then
      select s.title, s.updated_at, s.owner_id, s.deleted_at
        into title, updated_at, owner_id, v_deleted
        from public.sheets s where s.id = v_id;
    elsif v_kind = 'mindmap' then
      select m.title, m.updated_at, m.owner_id, m.deleted_at
        into title, updated_at, owner_id, v_deleted
        from public.mind_maps m where m.id = v_id;
    elsif v_kind = 'file' then
      select f.file_name, f.created_at, f.owner_id, f.size_bytes, f.mime_type, f.deleted_at
        into title, updated_at, owner_id, size_bytes, mime_type, v_deleted
        from public.files f where f.id = v_id;
    else
      continue;
    end if;

    if owner_id is null or v_deleted is not null then
      object_exists := false;
      can_view := false; can_edit := false;
      title := null; subtitle := null; size_bytes := null; mime_type := null; updated_at := null;
    else
      select coalesce(p.display_name, p.email) into owner_name
        from public.profiles p where p.id = owner_id;
      if not can_view then
        title := null; subtitle := null; size_bytes := null; mime_type := null; updated_at := null;
      end if;
    end if;

    return next;
  end loop;
end;
$$;

revoke all on function public.get_object_cards(jsonb) from public, anon;
grant execute on function public.get_object_cards(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 2) 첨부 후보에 다가오는 일정 추가 — 회의 링크를 채팅에 붙이는 흐름.
-- ----------------------------------------------------------------------------
create or replace function public.list_attachable_objects(
  p_query text default null,
  p_limit int default 40
)
returns table (kind text, id uuid, title text, subtitle text, updated_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  with q as (select nullif(btrim(coalesce(p_query, '')), '') as term),
  candidates as (
    select 'document'::text as kind, d.id, d.title as title, null::text as subtitle, d.updated_at
      from public.documents d
     where d.deleted_at is null and public.can_view_object('document', d.id)
    union all
    select 'sheet', s.id, s.title, null, s.updated_at
      from public.sheets s
     where s.deleted_at is null and public.can_view_object('sheet', s.id)
    union all
    select 'code', c.id, c.name, c.language, c.updated_at
      from public.code_files c
     where c.deleted_at is null and public.can_view_object('code', c.id)
    union all
    select 'mindmap', m.id, m.title, null, m.updated_at
      from public.mind_maps m
     where m.deleted_at is null and public.can_view_object('mindmap', m.id)
    union all
    select 'file', f.id, f.file_name, f.mime_type, f.created_at
      from public.files f
     where f.deleted_at is null and public.can_view_object('file', f.id)
    union all
    -- 지난 일정을 첨부할 일은 드물다 — 최근 7일부터 앞으로만 후보에 올린다.
    select 'event', e.id, e.title,
           to_char(e.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           e.starts_at
      from public.calendar_events e
     where e.starts_at >= now() - interval '7 days'
       and public.can_view_event(e.id)
  )
  select c.kind, c.id, coalesce(nullif(c.title, ''), 'Untitled') as title, c.subtitle, c.updated_at
    from candidates c, q
   where q.term is null or c.title ilike '%' || q.term || '%'
   order by c.updated_at desc nulls last
   limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

revoke all on function public.list_attachable_objects(text, int) from public, anon;
grant execute on function public.list_attachable_objects(text, int) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) 실시간 — `calendar:<uuid>` 토픽. 볼 수 있으면 수신, 고칠 수 있으면 발신.
-- ----------------------------------------------------------------------------
create or replace function public.realtime_topic_viewable(p_topic text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if p_topic like 'presence:%' then
    return public.realtime_topic_viewable(substring(p_topic from 10));
  elsif p_topic like 'doc:%' then
    return public.can_view_object('document', substring(p_topic from 5)::uuid);
  elsif p_topic like 'code:%' then
    return public.can_view_object('code', substring(p_topic from 6)::uuid);
  elsif p_topic like 'sheet:%' then
    return public.can_view_object('sheet', substring(p_topic from 7)::uuid);
  elsif p_topic like 'mindmap:%' then
    return public.can_view_object('mindmap', substring(p_topic from 9)::uuid);
  elsif p_topic like 'chat:%' then
    return public.is_chat_member(substring(p_topic from 6)::uuid);
  elsif p_topic like 'calendar:%' then
    return public.can_view_calendar(substring(p_topic from 10)::uuid);
  elsif p_topic like 'user:%' then
    return substring(p_topic from 6)::uuid = auth.uid();
  end if;
  return false;
exception when others then
  return false;
end;
$$;

create or replace function public.realtime_topic_editable(p_topic text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if p_topic like 'doc:%' then
    return public.can_edit_object('document', substring(p_topic from 5)::uuid);
  elsif p_topic like 'code:%' then
    return public.can_edit_object('code', substring(p_topic from 6)::uuid);
  elsif p_topic like 'sheet:%' then
    return public.can_edit_object('sheet', substring(p_topic from 7)::uuid);
  elsif p_topic like 'mindmap:%' then
    return public.can_edit_object('mindmap', substring(p_topic from 9)::uuid);
  elsif p_topic like 'chat:%' then
    return public.is_chat_member(substring(p_topic from 6)::uuid);
  elsif p_topic like 'calendar:%' then
    return public.can_edit_calendar(substring(p_topic from 10)::uuid);
  end if;
  return false;
exception when others then
  return false;
end;
$$;

revoke all on function public.realtime_topic_viewable(text) from public, anon;
grant execute on function public.realtime_topic_viewable(text) to authenticated;
revoke all on function public.realtime_topic_editable(text) from public, anon;
grant execute on function public.realtime_topic_editable(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) 초대 알림 — 참석자 행이 생기면 그 사람의 개인 토픽으로 한 통.
--    알림 실패가 일정 저장을 깨면 안 되므로 예외는 전부 삼킨다(0042 와 동일).
-- ----------------------------------------------------------------------------
create or replace function public.calendar_invite_fanout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
  v_organizer text;
begin
  if new.is_organizer then
    return new;                       -- 자기가 만든 일정을 자기에게 알리지 않는다
  end if;

  select e.title, e.starts_at, e.all_day, e.calendar_id, e.created_by
    into v_event
    from public.calendar_events e where e.id = new.event_id;
  if not found then
    return new;
  end if;

  select coalesce(display_name, email) into v_organizer
    from public.profiles where id = v_event.created_by;

  begin
    perform realtime.send(
      jsonb_build_object(
        'type', 'calendar_invite',
        'event_id', new.event_id,
        'calendar_id', v_event.calendar_id,
        'title', v_event.title,
        'starts_at', v_event.starts_at,
        'all_day', v_event.all_day,
        'organizer', coalesce(v_organizer, 'Someone')
      ),
      'calendar_invite',
      'user:' || new.user_id::text,
      true
    );
  exception when others then
    null;
  end;

  return new;
end;
$$;

create trigger calendar_event_attendees_fanout
after insert on public.calendar_event_attendees
for each row execute function public.calendar_invite_fanout();

revoke all on function public.calendar_invite_fanout() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5) ICS 구독 — Google/Apple 캘린더에 "URL 로 구독" 으로 넣는 주소.
--    토큰은 진짜 비밀이다. 본인만 읽을 수 있고, 유출되면 회전(rotate)한다.
-- ----------------------------------------------------------------------------
create table public.calendar_feed_tokens (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.calendar_feed_tokens enable row level security;

-- 읽기만 본인에게 허용한다. 발급/회전은 아래 RPC 로만 — 클라이언트가 토큰
-- 문자열을 직접 정하는 경로를 만들지 않는다(추측 가능한 토큰 방지).
create policy calendar_feed_tokens_select on public.calendar_feed_tokens for select
using (user_id = (select auth.uid()));

create or replace function public.get_calendar_feed_token(p_rotate boolean default false)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not p_rotate then
    select token into v_token from public.calendar_feed_tokens where user_id = auth.uid();
    if v_token is not null then
      return v_token;
    end if;
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.calendar_feed_tokens (user_id, token)
  values (auth.uid(), v_token)
  on conflict (user_id) do update set token = excluded.token, created_at = now();

  return v_token;
end;
$$;

revoke all on function public.get_calendar_feed_token(boolean) from public, anon;
grant execute on function public.get_calendar_feed_token(boolean) to authenticated;

-- 로그인 없이 불린다(캘린더 앱이 주기적으로 긁어 간다). 토큰이 유일한 인증
-- 수단이므로 여기서 auth.uid() 를 쓰지 않고, 토큰 주인의 시점으로 직접
-- 가시성을 계산한다 — can_view_calendar 는 auth.uid() 에 의존하므로 쓸 수 없다.
create or replace function public.get_calendar_feed(p_token text)
returns table (
  id uuid,
  calendar_name text,
  title text,
  description text,
  location text,
  conference_url text,
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean,
  recurrence text,
  recurrence_until timestamptz,
  status text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if p_token is null or char_length(p_token) < 32 then
    return;
  end if;

  select t.user_id into v_user
    from public.calendar_feed_tokens t where t.token = p_token;
  if v_user is null then
    return;
  end if;

  update public.calendar_feed_tokens set last_used_at = now() where user_id = v_user;

  return query
  select e.id,
         c.name,
         e.title,
         e.description,
         e.location,
         e.conference_url,
         e.starts_at,
         e.ends_at,
         e.all_day,
         e.recurrence,
         e.recurrence_until,
         e.status,
         e.updated_at
    from public.calendar_events e
    join public.calendars c on c.id = e.calendar_id
   where (
           c.owner_id = v_user
           or exists(select 1 from public.calendar_members m
                      where m.calendar_id = c.id and m.user_id = v_user)
           or exists(select 1 from public.calendar_event_attendees a
                      where a.event_id = e.id and a.user_id = v_user)
         )
     -- 무한정 내보내지 않는다 — 지난 1년, 앞으로 2년.
     and e.starts_at between now() - interval '1 year' and now() + interval '2 years'
   order by e.starts_at;
end;
$$;

revoke all on function public.get_calendar_feed(text) from public;
grant execute on function public.get_calendar_feed(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6) 다가오는 내 일정 — 대시보드/알림에서 쓴다. 반복 일정도 후보로 포함하고
--    실제 발생일은 앱이 전개한다(list_calendar_events 와 동일한 원칙).
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
  reminder_minutes int
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
         e.reminder_minutes
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
