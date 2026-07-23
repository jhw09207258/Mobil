-- ============================================================================
-- Comms 라이브 기능 — 전역 새 메시지 알림(fanout) · 읽음 확인용 멤버 조회
-- ----------------------------------------------------------------------------
-- 1) chat_message_fanout 트리거: 새 메시지가 저장되면 발신자를 제외한 모든
--    멤버의 개인 topic(`user:<id>`)으로 realtime.send 브로드캐스트를 쏜다.
--    클라이언트(전역 플로팅 채팅)는 자기 topic 하나만 구독하면 앱 어디에서든
--    즉시 알림(토스트)·안 읽음 배지를 받는다 — 대화별 채널을 전부 열 필요 없음.
--    알림 실패가 메시지 저장을 깨면 안 되므로 예외는 전부 삼킨다.
-- 2) get_chat_members: 멤버 이름/아바타/last_read_at — 읽음 표시(read receipt)
--    계산용. 프로필 직접 조회가 막혀 있으므로 SECURITY DEFINER 조인.
-- 3) realtime_topic_viewable 에 `user:<uuid>` 분기 추가 — 본인만 구독 가능.
--    (발신은 서버 트리거만 하므로 editable 은 확장하지 않는다.)
-- 타이핑 표시·읽음 이벤트는 기존 `chat:<id>` 채널의 클라이언트 브로드캐스트로
-- 처리한다(멤버만 송수신 가능 — 0040 의 인가가 그대로 적용됨). DDL 불필요.
-- ============================================================================

create or replace function public.get_chat_members(p_conversation uuid)
returns table (user_id uuid, name text, avatar_url text, last_read_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select m.user_id,
         coalesce(p.display_name, p.email) as name,
         p.avatar_url,
         m.last_read_at
  from public.chat_members m
  join public.profiles p on p.id = m.user_id
  where m.conversation_id = p_conversation
    and public.is_chat_member(p_conversation);
$$;

revoke all on function public.get_chat_members(uuid) from public, anon;
grant execute on function public.get_chat_members(uuid) to authenticated;

create or replace function public.chat_message_fanout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member uuid;
  v_sender_name text;
begin
  select coalesce(display_name, email) into v_sender_name
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
          'preview', left(new.content, 140),
          'created_at', new.created_at
        ),
        'chat-message',
        'user:' || v_member::text,
        true
      );
    exception when others then
      null; -- 알림은 부가 기능 — 메시지 저장을 절대 막지 않는다.
    end;
  end loop;
  return new;
end;
$$;

revoke all on function public.chat_message_fanout() from public, anon, authenticated;

create trigger chat_messages_fanout
after insert on public.chat_messages
for each row execute function public.chat_message_fanout();

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
  elsif p_topic like 'user:%' then
    -- 개인 알림 채널 — 본인만.
    return substring(p_topic from 6)::uuid = auth.uid();
  end if;
  return false;
exception when others then
  return false;
end;
$$;
