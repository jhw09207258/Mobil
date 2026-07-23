-- ============================================================================
-- Comms — 사용자 간 팀 채팅 (DM · 그룹)
-- ----------------------------------------------------------------------------
-- Sophia(AI 채팅, 0030)와 달리 여러 사용자가 참여하는 대화다. 구조는
-- conversations / members / messages 3테이블. 접근 통제의 단일 기준은
-- "멤버인가"이며, RLS 정책이 chat_conversations ↔ chat_members 를 서로
-- 참조하면 0017/0018 에서 겪은 상호 재귀가 재발하므로 멤버십 판정은
-- SECURITY DEFINER 헬퍼(is_chat_member) 하나로 모은다.
--
-- 실시간 전달은 기존 콘텐츠 협업과 동일한 Supabase Realtime Broadcast
-- (private 채널 + realtime.messages RLS)를 재사용한다 — topic 은
-- `chat:<conversation_id>`, 수신/발신 모두 멤버만 허용.
-- ============================================================================

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dm', 'group')),
  -- 그룹 대화 제목. DM 은 상대 이름으로 표시하므로 null.
  title text check (title is null or char_length(title) between 1 and 120),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger chat_conversations_set_updated_at
before update on public.chat_conversations
for each row execute function public.set_updated_at();

create table public.chat_members (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  -- 읽음 표시(안 읽은 메시지 수 계산 기준).
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index chat_members_user_idx on public.chat_members (user_id);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index chat_messages_conversation_idx
  on public.chat_messages (conversation_id, created_at desc);

-- 새 메시지가 오면 대화의 updated_at 을 올려 목록이 최근 활동순으로 정렬되게
-- 한다. 발신자에게 conversations UPDATE 권한이 없으므로 SECURITY DEFINER.
create or replace function public.chat_bump_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_conversations
     set updated_at = new.created_at
   where id = new.conversation_id;
  return new;
end;
$$;

create trigger chat_messages_bump_conversation
after insert on public.chat_messages
for each row execute function public.chat_bump_conversation();

-- 트리거 전용 — RPC 노출 차단.
revoke all on function public.chat_bump_conversation() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 멤버십 판정 헬퍼 — 모든 chat_* RLS 정책이 여기로만 위임한다(재귀 차단).
-- ----------------------------------------------------------------------------
create or replace function public.is_chat_member(p_conversation uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(
    select 1 from public.chat_members
    where conversation_id = p_conversation and user_id = auth.uid()
  );
$$;

revoke all on function public.is_chat_member(uuid) from public, anon;
grant execute on function public.is_chat_member(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- RLS — 대화 생성/멤버 추가는 아래 RPC(SECURITY DEFINER)로만 이루어진다.
-- ----------------------------------------------------------------------------
alter table public.chat_conversations enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;

create policy chat_conversations_select on public.chat_conversations for select
using (public.is_chat_member(id) or public.is_admin());

-- 그룹 제목 변경은 만든 사람만.
create policy chat_conversations_update on public.chat_conversations for update
using (created_by = (select auth.uid()));

create policy chat_conversations_delete on public.chat_conversations for delete
using (created_by = (select auth.uid()) or public.is_admin());

create policy chat_members_select on public.chat_members for select
using (public.is_chat_member(conversation_id) or public.is_admin());

-- 나가기(자기 멤버십 삭제)와 읽음 표시(자기 행 갱신)만 직접 허용.
create policy chat_members_update on public.chat_members for update
using (user_id = (select auth.uid()));

create policy chat_members_delete on public.chat_members for delete
using (user_id = (select auth.uid()));

create policy chat_messages_select on public.chat_messages for select
using (public.is_chat_member(conversation_id) or public.is_admin());

create policy chat_messages_insert on public.chat_messages for insert
with check (
  sender_id = (select auth.uid()) and public.is_chat_member(conversation_id)
);

create policy chat_messages_delete on public.chat_messages for delete
using (sender_id = (select auth.uid()) or public.is_admin());

-- ----------------------------------------------------------------------------
-- RPC — 대화 생성 · 목록 · 메시지 조회 · 읽음 · 멤버 추가
-- ----------------------------------------------------------------------------

-- DM 시작: 이미 둘만의 DM 이 있으면 그 id 를 돌려준다(중복 생성 방지).
create or replace function public.start_chat_dm(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
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

  select c.id into v_existing
  from public.chat_conversations c
  where c.kind = 'dm'
    and exists(select 1 from public.chat_members m where m.conversation_id = c.id and m.user_id = v_me)
    and exists(select 1 from public.chat_members m where m.conversation_id = c.id and m.user_id = p_other)
  limit 1;
  if v_existing is not null then return v_existing; end if;

  insert into public.chat_conversations (kind, created_by)
  values ('dm', v_me) returning id into v_id;
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
  v_id uuid;
  v_title text := nullif(trim(coalesce(p_title, '')), '');
begin
  if v_me is null then raise exception 'Authentication required'; end if;
  if v_title is null or char_length(v_title) > 120 then
    raise exception 'Group name must be 1-120 characters';
  end if;

  insert into public.chat_conversations (kind, title, created_by)
  values ('group', v_title, v_me) returning id into v_id;

  insert into public.chat_members (conversation_id, user_id)
  select v_id, u
  from (
    select distinct u
    -- p_members 가 null 이면 `null || v_me` 전체가 null 이 되어 멤버가 아무도
    -- 안 들어간다 — 빈 배열로 강제해 최소한 생성자는 항상 포함시킨다.
    from unnest(coalesce(p_members, '{}'::uuid[]) || v_me) as u
    where exists(select 1 from public.profiles p where p.id = u and p.approval_status = 'approved')
  ) s;
  return v_id;
end;
$$;

-- 멤버 추가는 기존 멤버 누구나 할 수 있다(그룹 전용).
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
  ) s
  on conflict (conversation_id, user_id) do nothing;
end;
$$;

-- 대화 목록: DM 은 상대 이름을 제목으로 계산하고, 마지막 메시지 미리보기와
-- 안 읽은 개수(내 last_read_at 이후 + 내가 보낸 게 아닌 것)를 함께 돌려준다.
create or replace function public.list_chat_conversations()
returns table (
  id uuid,
  kind text,
  title text,
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
  order by c.updated_at desc;
$$;

-- 메시지 + 발신자 프로필. 일반 사용자는 타인 프로필을 직접 조회할 수 없으므로
-- (0001/0020 정책) 발신자 이름/아바타는 이 SECURITY DEFINER 조인으로 붙인다.
create or replace function public.get_chat_messages(p_conversation uuid, p_limit int default 200)
returns table (
  id uuid,
  sender_id uuid,
  sender_name text,
  sender_avatar_url text,
  content text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select m.id, m.sender_id,
         coalesce(p.display_name, p.email) as sender_name,
         p.avatar_url as sender_avatar_url,
         m.content, m.created_at
  from public.chat_messages m
  join public.profiles p on p.id = m.sender_id
  where m.conversation_id = p_conversation
    and public.is_chat_member(p_conversation)
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

create or replace function public.mark_chat_read(p_conversation uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.chat_members
     set last_read_at = now()
   where conversation_id = p_conversation and user_id = auth.uid();
$$;

revoke all on function public.start_chat_dm(uuid) from public, anon;
grant execute on function public.start_chat_dm(uuid) to authenticated;
revoke all on function public.create_chat_group(text, uuid[]) from public, anon;
grant execute on function public.create_chat_group(text, uuid[]) to authenticated;
revoke all on function public.add_chat_members(uuid, uuid[]) from public, anon;
grant execute on function public.add_chat_members(uuid, uuid[]) to authenticated;
revoke all on function public.list_chat_conversations() from public, anon;
grant execute on function public.list_chat_conversations() to authenticated;
revoke all on function public.get_chat_messages(uuid, int) from public, anon;
grant execute on function public.get_chat_messages(uuid, int) to authenticated;
revoke all on function public.mark_chat_read(uuid) from public, anon;
grant execute on function public.mark_chat_read(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Realtime Broadcast 채널 인가 — `chat:<conversation_id>` topic 을 멤버에게만
-- 허용한다. 0039(viewable, presence: 접두사 포함)/0031(editable) 의 최신
-- 정의를 그대로 유지한 채 chat 분기만 추가한다.
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
  end if;
  return false;
exception when others then
  return false;
end;
$$;
