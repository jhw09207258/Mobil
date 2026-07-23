-- ============================================================================
-- 프로필 사진 연동 확장 — 대화 목록(DM 상대 아바타) · 알림 fanout(발신자 아바타)
-- ----------------------------------------------------------------------------
-- list_chat_conversations 반환 컬럼이 늘어나므로(OUT 파라미터 변경) drop 후
-- 재생성한다.
-- ============================================================================

drop function if exists public.list_chat_conversations();

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
    -- DM 은 상대의 프로필 사진, 그룹은 null(⌗ 아이콘 유지).
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
  order by c.updated_at desc;
$$;

revoke all on function public.list_chat_conversations() from public, anon;
grant execute on function public.list_chat_conversations() to authenticated;

-- fanout 알림 payload 에 발신자 아바타 포함(토스트에 프로필 사진 표시용).
create or replace function public.chat_message_fanout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member uuid;
  v_sender_name text;
  v_sender_avatar text;
begin
  select coalesce(display_name, email), avatar_url
    into v_sender_name, v_sender_avatar
  from public.profiles where id = new.sender_id;

  for v_member in
    select user_id from public.chat_members
    where conversation_id = new.conversation_id and user_id <> new.sender_id
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
$$;

revoke all on function public.chat_message_fanout() from public, anon, authenticated;
