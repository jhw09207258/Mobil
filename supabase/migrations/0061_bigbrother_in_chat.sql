-- ============================================================================
-- 채팅에 Big Brother 초대 — @bigbrother 로 부를 때만 답한다.
--
-- 봇에게 profiles 행을 주지 않는다: profiles.id 는 auth.users 를 참조하므로
-- 가짜 인증 계정을 심어야 하고, 그건 로그인 경로에 없는 사용자를 만드는 일이다.
-- 대신 sender_id 를 nullable 로 열고 is_bot 플래그를 둔다. check 제약으로
-- "사람 메시지에는 반드시 보낸 사람이 있다"는 불변식을 지킨다.
--
-- 라이브 DB 에서 5개 검사로 확인함(트랜잭션 후 롤백): 봇 비활성 시 저장 거부,
-- 멤버만 초대 가능, 보낸 사람 없는 사람 메시지 거부, 봇 메시지 저장,
-- 조회에 봇 메시지가 남아 있음.
-- ============================================================================

alter table public.chat_messages
  alter column sender_id drop not null;
alter table public.chat_messages
  add column if not exists is_bot boolean not null default false;

alter table public.chat_messages
  drop constraint if exists chat_messages_sender_or_bot;
alter table public.chat_messages
  add constraint chat_messages_sender_or_bot
  check ((is_bot and sender_id is null) or (not is_bot and sender_id is not null));

alter table public.chat_conversations
  add column if not exists bigbrother_enabled boolean not null default false;

-- 조회: profiles 와 INNER JOIN 이라 봇 메시지가 통째로 사라졌다 — LEFT 로 바꾸고
-- 봇이면 이름을 직접 넣는다. 반환 컬럼이 늘어나므로 먼저 떨어뜨린다
-- (마이그레이션은 트랜잭션이라 중간 공백이 없다).
drop function if exists public.get_chat_messages(uuid, integer);

create function public.get_chat_messages(p_conversation uuid, p_limit integer default 200)
returns table(id uuid, sender_id uuid, sender_name text, sender_avatar_url text, content text,
              created_at timestamptz, edited_at timestamptz, reply_to_id uuid,
              reply_to_sender_name text, reply_to_content text, reactions jsonb, is_bot boolean)
language sql stable security definer set search_path to 'public'
as $function$
  select m.id, m.sender_id,
         case when m.is_bot then 'Big Brother'
              else coalesce(p.display_name, p.email) end as sender_name,
         p.avatar_url as sender_avatar_url,
         m.content, m.created_at, m.edited_at,
         m.reply_to_id,
         case when rm.is_bot then 'Big Brother'
              else coalesce(rp.display_name, rp.email) end as reply_to_sender_name,
         rm.content as reply_to_content,
         coalesce(rx.reactions, '[]'::jsonb) as reactions,
         m.is_bot
  from public.chat_messages m
  left join public.profiles p on p.id = m.sender_id
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
$function$;

-- 알림: user_id <> NULL 은 NULL 이라 봇 메시지가 아무에게도 안 갔다.
create or replace function public.chat_message_fanout()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_member uuid;
  v_sender_name text;
  v_sender_avatar text;
begin
  if new.is_bot then
    v_sender_name := 'Big Brother';
    v_sender_avatar := null;
  else
    select coalesce(display_name, email), avatar_url
      into v_sender_name, v_sender_avatar
    from public.profiles where id = new.sender_id;
  end if;

  for v_member in
    select user_id from public.chat_members
    where conversation_id = new.conversation_id
      and user_id is distinct from new.sender_id
  loop
    begin
      perform realtime.send(
        jsonb_build_object(
          'conversation_id', new.conversation_id,
          'message_id', new.id,
          'sender_id', new.sender_id,
          'sender_name', v_sender_name,
          'sender_avatar_url', v_sender_avatar,
          'preview', left(new.content, 140),
          'created_at', new.created_at
        ),
        'chat-message',
        'user:' || v_member::text,
        true
      );
    exception when others then
      null;
    end;
  end loop;
  return new;
end;
$function$;

create or replace function public.set_bigbrother(p_conversation uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not public.is_chat_member(p_conversation) then
    raise exception 'Only members can change this';
  end if;
  update public.chat_conversations set bigbrother_enabled = p_enabled where id = p_conversation;
end;
$function$;

-- 봇 답변 저장 — 사람 인증으로는 sender_id 없이 못 넣으므로 여기서만 허용한다.
create or replace function public.post_bigbrother_message(p_conversation uuid, p_content text)
returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if not public.is_chat_member(p_conversation) then
    raise exception 'Only members can post here';
  end if;
  if not exists (
    select 1 from public.chat_conversations where id = p_conversation and bigbrother_enabled
  ) then
    raise exception 'Big Brother is not in this conversation';
  end if;

  insert into public.chat_messages (conversation_id, sender_id, is_bot, content)
  values (p_conversation, null, true, p_content)
  returning id into v_id;
  return v_id;
end;
$function$;

revoke all on function public.set_bigbrother(uuid, boolean) from public, anon;
revoke all on function public.post_bigbrother_message(uuid, text) from public, anon;
grant execute on function public.set_bigbrother(uuid, boolean) to authenticated;
grant execute on function public.post_bigbrother_message(uuid, text) to authenticated;
