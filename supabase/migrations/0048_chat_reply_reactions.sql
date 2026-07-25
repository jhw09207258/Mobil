-- ============================================================================
-- 채팅 답장(reply) + 공감(reaction)
-- ----------------------------------------------------------------------------
-- reply: chat_messages.reply_to_id 로 같은 테이블을 참조. 원본이 삭제되면
--   set null 로 끊는다(고아 참조 방지 — 답장 자체는 남고 인용 미리보기만
--   사라진다).
-- reaction: 메시지당 (user, emoji) 유일 — 같은 이모지를 다시 누르면 토글
--   (취소)된다. 멤버십 검증은 SECURITY DEFINER RPC(toggle_chat_reaction)
--   안에서 한 번에 처리하므로 RLS 정책은 방어적 안전망 성격이다.
-- get_chat_messages 는 반환 타입이 늘어나므로 0046 과 동일한 이유로 drop 후
-- 재생성해야 한다.
-- ============================================================================

alter table public.chat_messages
  add column if not exists reply_to_id uuid references public.chat_messages(id) on delete set null;

create table public.chat_message_reactions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index chat_message_reactions_message_idx on public.chat_message_reactions (message_id);

alter table public.chat_message_reactions enable row level security;

create policy chat_message_reactions_select on public.chat_message_reactions for select
using (
  exists (
    select 1 from public.chat_messages m
    where m.id = message_id and public.is_chat_member(m.conversation_id)
  )
);

create policy chat_message_reactions_insert on public.chat_message_reactions for insert
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.chat_messages m
    where m.id = message_id and public.is_chat_member(m.conversation_id)
  )
);

create policy chat_message_reactions_delete on public.chat_message_reactions for delete
using (user_id = (select auth.uid()));

-- 토글 — 같은 (메시지, 나, 이모지) 행이 있으면 지우고 false, 없으면 넣고 true.
create or replace function public.toggle_chat_reaction(p_message uuid, p_emoji text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_conv uuid;
  v_deleted int;
begin
  if v_me is null then raise exception 'Authentication required'; end if;
  if p_emoji is null or char_length(p_emoji) not between 1 and 8 then
    raise exception 'Invalid emoji';
  end if;

  select conversation_id into v_conv from public.chat_messages where id = p_message;
  if v_conv is null or not public.is_chat_member(v_conv) then
    raise exception 'Not a member of this conversation';
  end if;

  delete from public.chat_message_reactions
   where message_id = p_message and user_id = v_me and emoji = p_emoji;
  get diagnostics v_deleted = row_count;
  if v_deleted > 0 then
    return false;
  end if;

  insert into public.chat_message_reactions (message_id, user_id, emoji)
  values (p_message, v_me, p_emoji);
  return true;
end;
$$;

revoke all on function public.toggle_chat_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_chat_reaction(uuid, text) to authenticated;

-- get_chat_messages 재정의 — 답장 미리보기 + 공감 집계 포함.
drop function if exists public.get_chat_messages(uuid, int);
create function public.get_chat_messages(p_conversation uuid, p_limit int default 200)
returns table (
  id uuid,
  sender_id uuid,
  sender_name text,
  sender_avatar_url text,
  content text,
  created_at timestamptz,
  edited_at timestamptz,
  reply_to_id uuid,
  reply_to_sender_name text,
  reply_to_content text,
  reactions jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  select m.id, m.sender_id,
         coalesce(p.display_name, p.email) as sender_name,
         p.avatar_url as sender_avatar_url,
         m.content, m.created_at, m.edited_at,
         m.reply_to_id,
         coalesce(rp.display_name, rp.email) as reply_to_sender_name,
         rm.content as reply_to_content,
         coalesce(rx.reactions, '[]'::jsonb) as reactions
  from public.chat_messages m
  join public.profiles p on p.id = m.sender_id
  left join public.chat_messages rm on rm.id = m.reply_to_id
  left join public.profiles rp on rp.id = rm.sender_id
  left join lateral (
    select jsonb_agg(
             jsonb_build_object('emoji', t.emoji, 'count', t.cnt, 'reacted_by_me', t.me)
             order by t.emoji
           ) as reactions
    from (
      select emoji, count(*) as cnt, bool_or(user_id = auth.uid()) as me
      from public.chat_message_reactions
      where message_id = m.id
      group by emoji
    ) t
  ) rx on true
  where m.conversation_id = p_conversation
    and public.is_chat_member(p_conversation)
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

revoke all on function public.get_chat_messages(uuid, int) from public, anon;
grant execute on function public.get_chat_messages(uuid, int) to authenticated;
