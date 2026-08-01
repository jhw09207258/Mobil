-- ============================================================================
-- 팀(워크스페이스) — Possion 을 여러 조직이 함께 쓰는 다중 테넌트 구조로.
-- ----------------------------------------------------------------------------
-- 지금까지는 "사용자 = 하나의 공용 공간" 이었다. 이제 사용자는 여러 팀에
-- 속할 수 있고, 그중 하나를 "현재 팀"(profiles.active_team_id)으로 골라
-- 그 팀 맥락에서 일한다 — Slack 이 워크스페이스를 다루는 방식과 같다.
--
--   * 팀장(teams.leader_id)은 한 명뿐이고 위임할 수 있다. 팀을 열림/닫힘으로
--     설정해 열림이면 신청 즉시 가입, 닫힘이면 팀장 승인이 필요하다.
--     팀장은 팀을 삭제할 수 있다.
--   * 신규 가입자는 "가입 시" 팀을 만들어 팀장이 되거나, 팀 목록을 검색해
--     가입 신청을 한다(app/(app)/layout.tsx 의 온보딩 게이트가 강제한다).
--   * Repository(및 그 안의 콘텐츠)와 채팅은 "현재 팀" 단위로 나뉜다 —
--     팀을 바꾸면 보이는 저장소/대화가 바뀐다. 문서·코드·시트·마인드맵·
--     파일 자체의 소유/공유 체계(0001, 0074 등)는 그대로 두고, "누구와
--     공유/채팅할 수 있는가"만 같은 팀으로 제한한다(문서 자체를 팀 소유로
--     바꾸는 건 아니다 — 기존 개인 소유 모델과 공존한다).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- teams / team_members
-- ---------------------------------------------------------------------------
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  is_open boolean not null default true,
  leader_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger teams_set_updated_at
before update on public.teams
for each row execute function public.set_updated_at();

create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'pending')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index team_members_user_idx on public.team_members (user_id);

alter table public.profiles
  add column active_team_id uuid references public.teams(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 헬퍼 — RLS 재귀를 피하려고(0017/0018/0040 과 같은 이유) 멤버십/팀장 판정을
-- SECURITY DEFINER 함수 하나로 모은다.
-- ---------------------------------------------------------------------------
create or replace function public.is_team_leader(p_team uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(select 1 from public.teams where id = p_team and leader_id = auth.uid());
$$;

create or replace function public.is_team_member(p_team uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(
    select 1 from public.team_members
    where team_id = p_team and user_id = auth.uid() and status = 'active'
  );
$$;

-- 호출자와 p_other 가 "내 현재 팀"을 공유하는가 — 공유/채팅 대상 검증에 쓴다.
create or replace function public.shares_active_team(p_other uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(
    select 1
    from public.profiles p
    join public.team_members tm
      on tm.team_id = p.active_team_id and tm.user_id = p_other and tm.status = 'active'
    where p.id = auth.uid() and p.active_team_id is not null
  );
$$;

revoke all on function public.is_team_leader(uuid) from public, anon;
grant execute on function public.is_team_leader(uuid) to authenticated;
revoke all on function public.is_team_member(uuid) from public, anon;
grant execute on function public.is_team_member(uuid) to authenticated;
revoke all on function public.shares_active_team(uuid) from public, anon;
grant execute on function public.shares_active_team(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS — teams/team_members 는 아래 RPC(SECURITY DEFINER)로만 바뀐다.
-- ---------------------------------------------------------------------------
alter table public.teams enable row level security;
alter table public.team_members enable row level security;

-- 팀 검색/가입 신청을 하려면 비공개 팀도 이름/설명/공개여부 정도는 보여야
-- 한다 — 멤버 명단은 team_members 의 별도 정책으로 가른다.
create policy teams_select on public.teams for select
using (true);

create policy teams_block_insert on public.teams for insert with check (false);
create policy teams_block_update on public.teams for update using (false);
create policy teams_block_delete on public.teams for delete using (false);

create policy team_members_select on public.team_members for select
using (
  user_id = auth.uid()
  or public.is_team_member(team_id)
  or public.is_team_leader(team_id)
  or public.is_admin()
);

create policy team_members_block_insert on public.team_members for insert with check (false);
create policy team_members_block_update on public.team_members for update using (false);
create policy team_members_block_delete on public.team_members for delete using (false);

-- ---------------------------------------------------------------------------
-- RPC — 생성 · 가입/승인/거절 · 탈퇴/추방 · 위임 · 열림설정 · 삭제 · 팀전환
-- ---------------------------------------------------------------------------
create or replace function public.create_team(
  p_name text,
  p_description text default null,
  p_is_open boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_name text := trim(coalesce(p_name, ''));
  v_id uuid;
begin
  if v_me is null then raise exception 'Authentication required'; end if;
  if v_name = '' or char_length(v_name) > 80 then
    raise exception 'Team name must be 1-80 characters';
  end if;

  insert into public.teams (name, description, is_open, leader_id)
  values (v_name, nullif(trim(coalesce(p_description, '')), ''), coalesce(p_is_open, true), v_me)
  returning id into v_id;

  insert into public.team_members (team_id, user_id, status) values (v_id, v_me, 'active');
  update public.profiles set active_team_id = v_id where id = v_me;

  return v_id;
end;
$$;

-- 열림 팀은 즉시 가입, 닫힘 팀은 대기 신청 — 반환값으로 어느 쪽인지 알린다.
create or replace function public.request_join_team(p_team uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_open boolean;
  v_existing text;
begin
  if v_me is null then raise exception 'Authentication required'; end if;

  select is_open into v_open from public.teams where id = p_team;
  if v_open is null then raise exception 'Team not found'; end if;

  select status into v_existing from public.team_members where team_id = p_team and user_id = v_me;
  if v_existing = 'active' then raise exception 'You are already a member of this team'; end if;
  if v_existing = 'pending' then raise exception 'Your request to join is already pending'; end if;

  if v_open then
    insert into public.team_members (team_id, user_id, status) values (p_team, v_me, 'active');
    update public.profiles set active_team_id = p_team where id = v_me;
    return 'joined';
  else
    insert into public.team_members (team_id, user_id, status) values (p_team, v_me, 'pending');
    return 'pending';
  end if;
end;
$$;

create or replace function public.approve_team_member(p_team uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_team_leader(p_team) or public.is_admin()) then
    raise exception 'not_authorized';
  end if;
  update public.team_members set status = 'active'
   where team_id = p_team and user_id = p_user and status = 'pending';
end;
$$;

create or replace function public.reject_team_member(p_team uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_team_leader(p_team) or public.is_admin()) then
    raise exception 'not_authorized';
  end if;
  delete from public.team_members where team_id = p_team and user_id = p_user and status = 'pending';
end;
$$;

create or replace function public.remove_team_member(p_team uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_team_leader(p_team) or public.is_admin()) then
    raise exception 'not_authorized';
  end if;
  if p_user = (select leader_id from public.teams where id = p_team) then
    raise exception 'Transfer leadership before removing the team leader';
  end if;
  delete from public.team_members where team_id = p_team and user_id = p_user;
  update public.profiles set active_team_id = null where id = p_user and active_team_id = p_team;
end;
$$;

create or replace function public.leave_team(p_team uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Authentication required'; end if;
  if (select leader_id from public.teams where id = p_team) = v_me then
    raise exception 'Transfer leadership or delete the team before leaving';
  end if;
  delete from public.team_members where team_id = p_team and user_id = v_me;
  update public.profiles set active_team_id = null where id = v_me and active_team_id = p_team;
end;
$$;

create or replace function public.transfer_team_leadership(p_team uuid, p_new_leader uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_team_leader(p_team) or public.is_admin()) then
    raise exception 'not_authorized';
  end if;
  if not exists(
    select 1 from public.team_members
    where team_id = p_team and user_id = p_new_leader and status = 'active'
  ) then
    raise exception 'The new leader must already be an active member of this team';
  end if;
  update public.teams set leader_id = p_new_leader where id = p_team;
end;
$$;

create or replace function public.set_team_open(p_team uuid, p_is_open boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_team_leader(p_team) or public.is_admin()) then
    raise exception 'not_authorized';
  end if;
  update public.teams set is_open = p_is_open where id = p_team;
end;
$$;

create or replace function public.delete_team(p_team uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_team_leader(p_team) or public.is_admin()) then
    raise exception 'not_authorized';
  end if;
  delete from public.teams where id = p_team;
end;
$$;

create or replace function public.set_active_team(p_team uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Authentication required'; end if;
  if p_team is not null and not exists(
    select 1 from public.team_members where team_id = p_team and user_id = v_me and status = 'active'
  ) then
    raise exception 'You are not a member of this team';
  end if;
  update public.profiles set active_team_id = p_team where id = v_me;
end;
$$;

revoke all on function public.create_team(text, text, boolean) from public, anon;
grant execute on function public.create_team(text, text, boolean) to authenticated;
revoke all on function public.request_join_team(uuid) from public, anon;
grant execute on function public.request_join_team(uuid) to authenticated;
revoke all on function public.approve_team_member(uuid, uuid) from public, anon;
grant execute on function public.approve_team_member(uuid, uuid) to authenticated;
revoke all on function public.reject_team_member(uuid, uuid) from public, anon;
grant execute on function public.reject_team_member(uuid, uuid) to authenticated;
revoke all on function public.remove_team_member(uuid, uuid) from public, anon;
grant execute on function public.remove_team_member(uuid, uuid) to authenticated;
revoke all on function public.leave_team(uuid) from public, anon;
grant execute on function public.leave_team(uuid) to authenticated;
revoke all on function public.transfer_team_leadership(uuid, uuid) from public, anon;
grant execute on function public.transfer_team_leadership(uuid, uuid) to authenticated;
revoke all on function public.set_team_open(uuid, boolean) from public, anon;
grant execute on function public.set_team_open(uuid, boolean) to authenticated;
revoke all on function public.delete_team(uuid) from public, anon;
grant execute on function public.delete_team(uuid) to authenticated;
revoke all on function public.set_active_team(uuid) from public, anon;
grant execute on function public.set_active_team(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 조회 RPC — 검색 · 내 팀 목록 · 팀원 명단
-- ---------------------------------------------------------------------------
create or replace function public.search_teams(p_query text default '')
returns table(
  id uuid, name text, description text, is_open boolean,
  member_count bigint, leader_name text, my_status text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    t.id, t.name, t.description, t.is_open,
    (select count(*) from public.team_members m where m.team_id = t.id and m.status = 'active') as member_count,
    coalesce(lp.display_name, lp.email) as leader_name,
    (select tm.status from public.team_members tm where tm.team_id = t.id and tm.user_id = auth.uid())
  from public.teams t
  join public.profiles lp on lp.id = t.leader_id
  where p_query is null or p_query = '' or t.name ilike '%' || p_query || '%'
  order by member_count desc, t.name
  limit 30;
$$;

create or replace function public.list_my_teams()
returns table(
  id uuid, name text, description text, is_open boolean,
  member_count bigint, leader_id uuid, is_leader boolean, status text, is_active_team boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    t.id, t.name, t.description, t.is_open,
    (select count(*) from public.team_members m2 where m2.team_id = t.id and m2.status = 'active'),
    t.leader_id,
    t.leader_id = auth.uid(),
    m.status,
    t.id = (select active_team_id from public.profiles where id = auth.uid())
  from public.team_members m
  join public.teams t on t.id = m.team_id
  where m.user_id = auth.uid()
  order by (t.id = (select active_team_id from public.profiles where id = auth.uid())) desc, t.name;
$$;

create or replace function public.list_team_members(p_team uuid)
returns table(
  id uuid, display_name text, email text, avatar_url text,
  status text, is_leader boolean, joined_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.display_name, p.email, p.avatar_url, m.status,
         t.leader_id = p.id, m.joined_at
  from public.team_members m
  join public.profiles p on p.id = m.user_id
  join public.teams t on t.id = m.team_id
  where m.team_id = p_team
    and (public.is_team_member(p_team) or public.is_team_leader(p_team) or public.is_admin())
  order by (t.leader_id = p.id) desc, m.status, m.joined_at;
$$;

revoke all on function public.search_teams(text) from public, anon;
grant execute on function public.search_teams(text) to authenticated;
revoke all on function public.list_my_teams() from public, anon;
grant execute on function public.list_my_teams() to authenticated;
revoke all on function public.list_team_members(uuid) from public, anon;
grant execute on function public.list_team_members(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Repository — 팀 단위로 나눈다. 생성 시 team_id 를 안 주면 만드는 사람의
-- 현재 팀으로 채운다(app 레이어를 고칠 필요가 없게). 팀을 바꾸면 그 팀에
-- 속하지 않은 내 저장소는 보이지 않는다(삭제되지 않는다 — 다시 그 팀으로
-- 돌아오면 그대로 있다).
-- ---------------------------------------------------------------------------
alter table public.repositories
  add column team_id uuid references public.teams(id) on delete set null;

create or replace function public.set_repository_team()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.team_id is null then
    select active_team_id into new.team_id from public.profiles where id = new.owner_id;
  end if;
  return new;
end;
$$;

create trigger repositories_set_team
before insert on public.repositories
for each row execute function public.set_repository_team();

drop policy repositories_select on public.repositories;
create policy repositories_select on public.repositories for select
using (
  (owner_id = (select auth.uid())
    and (team_id is null or team_id = (select active_team_id from public.profiles where id = auth.uid())))
  or public.is_admin()
);

-- ---------------------------------------------------------------------------
-- Chat — 대화도 팀 단위. 시작/생성 시점의 "현재 팀"에 걸리고, 그 팀에
-- 속하지 않은 사람과는 애초에 대화를 시작/추가할 수 없다.
-- ---------------------------------------------------------------------------
alter table public.chat_conversations
  add column team_id uuid references public.teams(id) on delete set null;

create or replace function public.start_chat_dm(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_team uuid;
  v_existing uuid;
  v_id uuid;
begin
  if v_me is null then raise exception 'Authentication required'; end if;
  if p_other is null or p_other = v_me then
    raise exception 'Pick another user to message';
  end if;
  if not exists(
    select 1 from public.profiles
    where id = p_other and approval_status = 'approved'
  ) then
    raise exception 'User not found';
  end if;
  if not public.shares_active_team(p_other) then
    raise exception 'You can only message people on your current team';
  end if;

  select active_team_id into v_team from public.profiles where id = v_me;

  select c.id into v_existing
  from public.chat_conversations c
  where c.kind = 'dm'
    and c.team_id is not distinct from v_team
    and exists(select 1 from public.chat_members m where m.conversation_id = c.id and m.user_id = v_me)
    and exists(select 1 from public.chat_members m where m.conversation_id = c.id and m.user_id = p_other)
  limit 1;
  if v_existing is not null then return v_existing; end if;

  insert into public.chat_conversations (kind, created_by, team_id)
  values ('dm', v_me, v_team) returning id into v_id;
  insert into public.chat_members (conversation_id, user_id)
  values (v_id, v_me), (v_id, p_other);
  return v_id;
end;
$$;

create or replace function public.create_chat_group(p_title text, p_members uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_team uuid;
  v_id uuid;
  v_title text := nullif(trim(coalesce(p_title, '')), '');
begin
  if v_me is null then raise exception 'Authentication required'; end if;
  if v_title is null or char_length(v_title) > 120 then
    raise exception 'Group name must be 1-120 characters';
  end if;

  select active_team_id into v_team from public.profiles where id = v_me;
  if v_team is null then raise exception 'Join a team before creating a group'; end if;

  insert into public.chat_conversations (kind, title, created_by, team_id)
  values ('group', v_title, v_me, v_team) returning id into v_id;

  insert into public.chat_members (conversation_id, user_id)
  select v_id, u
  from (
    select distinct u
    from unnest(coalesce(p_members, '{}'::uuid[]) || v_me) as u
    where exists(select 1 from public.profiles p where p.id = u and p.approval_status = 'approved')
      and (u = v_me or public.shares_active_team(u))
  ) s;
  return v_id;
end;
$$;

create or replace function public.add_chat_members(p_conversation uuid, p_members uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_chat_member(p_conversation) then
    raise exception 'Not a member of this conversation';
  end if;
  if not exists(
    select 1 from public.chat_conversations
    where id = p_conversation and kind = 'group'
  ) then
    raise exception 'Members can only be added to group conversations';
  end if;

  insert into public.chat_members (conversation_id, user_id)
  select p_conversation, u
  from (
    select distinct u
    from unnest(p_members) as u
    where exists(select 1 from public.profiles p where p.id = u and p.approval_status = 'approved')
      and public.shares_active_team(u)
  ) s
  on conflict (conversation_id, user_id) do nothing;
end;
$$;

-- 0043(chat_avatars)이 avatar_url 컬럼을 더한 뒤의 최신 모양을 기준으로,
-- team_id 필터만 얹는다(0040 의 옛 모양으로 되돌리면 반환 컬럼 수가 줄어
-- "cannot change return type" 오류가 난다 — 로컬 재생 중 실제로 걸렸다).
create or replace function public.list_chat_conversations()
returns table (
  id uuid,
  kind text,
  title text,
  avatar_url text,
  member_count bigint,
  last_message text,
  last_message_at timestamptz,
  unread_count bigint,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    c.id,
    c.kind,
    case
      when c.kind = 'group' then coalesce(c.title, 'Untitled group')
      else coalesce(
        (select coalesce(p.display_name, p.email)
         from public.chat_members m
         join public.profiles p on p.id = m.user_id
         where m.conversation_id = c.id and m.user_id <> auth.uid()
         limit 1),
        'Direct message')
    end as title,
    case
      when c.kind = 'dm' then
        (select p.avatar_url
         from public.chat_members m
         join public.profiles p on p.id = m.user_id
         where m.conversation_id = c.id and m.user_id <> auth.uid()
         limit 1)
    end as avatar_url,
    (select count(*) from public.chat_members m where m.conversation_id = c.id) as member_count,
    lm.content as last_message,
    lm.created_at as last_message_at,
    (select count(*) from public.chat_messages msg
      where msg.conversation_id = c.id
        and msg.created_at > me.last_read_at
        and msg.sender_id <> auth.uid()) as unread_count,
    c.updated_at
  from public.chat_conversations c
  join public.chat_members me
    on me.conversation_id = c.id and me.user_id = auth.uid()
  left join lateral (
    select content, created_at from public.chat_messages msg
    where msg.conversation_id = c.id
    order by msg.created_at desc limit 1
  ) lm on true
  where c.team_id is not distinct from (select active_team_id from public.profiles where id = auth.uid())
  order by c.updated_at desc;
$$;

-- ---------------------------------------------------------------------------
-- Co-workers / 공유 대상 — "같은 팀" 으로 좁힌다. list_coworkers 는 채팅
-- 상대 선택기와 /coworkers 디렉터리가 함께 쓴다 — 둘 다 이제 "같은 팀"
-- 의미로 자연스럽게 좁혀진다.
-- ---------------------------------------------------------------------------
create or replace function public.list_coworkers()
returns table(
  id uuid,
  display_name text,
  email text,
  role text,
  gender text,
  bio text,
  avatar_url text,
  age smallint,
  address text,
  phone text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    p.display_name,
    p.email,
    p.role,
    p.gender,
    p.bio,
    p.avatar_url,
    case when p.age_public then p.age else null end,
    case when p.address_public then p.address else null end,
    case when p.phone_public then p.phone else null end
  from public.profiles p
  where p.id <> auth.uid()
    and p.approval_status = 'approved'
    and public.shares_active_team(p.id)
  order by coalesce(p.display_name, p.email);
$$;

-- 문서/코드/시트/마인드맵/파일 공유는 같은 팀에게만 — 소유자 조건은 그대로
-- 두고 "받는 사람이 내 현재 팀 소속인가" 만 얹는다(0018/0074 의 최신 정의
-- 위에 이어 붙인다).
drop policy document_permissions_insert on public.document_permissions;
create policy document_permissions_insert on public.document_permissions for insert
with check (
  (public.is_document_owner(document_id) and public.shares_active_team(user_id))
  or (public.is_admin() and not public.is_owner_only_document(document_id))
);

drop policy code_file_permissions_insert on public.code_file_permissions;
create policy code_file_permissions_insert on public.code_file_permissions for insert
with check (
  (public.is_code_file_owner(code_file_id) and public.shares_active_team(user_id))
  or public.is_admin()
);

drop policy sheet_permissions_insert on public.sheet_permissions;
create policy sheet_permissions_insert on public.sheet_permissions for insert
with check (
  (public.is_sheet_owner(sheet_id) and public.shares_active_team(user_id))
  or public.is_admin()
);

drop policy mind_map_permissions_insert on public.mind_map_permissions;
create policy mind_map_permissions_insert on public.mind_map_permissions for insert
with check (
  (public.is_mind_map_owner(mind_map_id) and public.shares_active_team(user_id))
  or public.is_admin()
);

drop policy file_permissions_insert on public.file_permissions;
create policy file_permissions_insert on public.file_permissions for insert
with check (
  (public.is_file_owner(file_id) and public.shares_active_team(user_id))
  or public.is_admin()
);

-- ---------------------------------------------------------------------------
-- 백필 — 지금 있는 사용자 전부를 "Yegrina Haute Group" 팀에 넣고, 팀장을
-- jhw09207258@gmail.com 으로 세운다. 기존 저장소/대화도 이 팀으로 옮긴다.
-- 아직 트리거/RLS 가 새로 걸리기 전이므로 일반 INSERT/UPDATE 로 충분하다
-- (0019 의 approval_status 백필과 같은 방식).
-- ---------------------------------------------------------------------------
do $$
declare
  v_leader uuid;
  v_team uuid;
begin
  select id into v_leader from public.profiles where email = 'jhw09207258@gmail.com';

  if v_leader is null then
    -- 이 이메일 사용자가 아직 없는 환경(로컬 검증 DB 등)에서는 가장 먼저
    -- 가입한 사용자를 임시 팀장으로 세운다 — 실제 배포 환경에는 있다.
    select id into v_leader from public.profiles order by created_at asc limit 1;
  end if;

  if v_leader is null then
    return; -- 사용자가 한 명도 없으면 백필할 것이 없다.
  end if;

  insert into public.teams (name, description, is_open, leader_id)
  values (
    'Yegrina Haute Group',
    'Possion 의 첫 팀 — 기존 사용자 전원이 여기 속한다.',
    false,
    v_leader
  )
  returning id into v_team;

  insert into public.team_members (team_id, user_id, status)
  select v_team, id, 'active' from public.profiles;

  update public.profiles set active_team_id = v_team;
  update public.repositories set team_id = v_team where team_id is null;
  update public.chat_conversations set team_id = v_team where team_id is null;
end $$;
