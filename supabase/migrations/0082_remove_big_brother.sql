-- ============================================================================
-- Big Brother 제거 — /big-brother 메뉴(Assistant/Agent/Search console 탭)와
-- 채팅의 @bigbrother 멘션 봇을 없앤다.
-- ----------------------------------------------------------------------------
-- Sophia(/sophia, ai_conversations/ai_messages 기반 개인 채팅)는 완전히
-- 별개로 남는다 — Sophia 를 실제로 돌리는 lib/big-brother-claude.ts 등의
-- 모델 러너 파일들은 "Big Brother" 라는 옛 이름이 붙어 있을 뿐 이 정리와
-- 무관하고, DB 쪽에도 그 파일들이 쓰는 테이블/함수는 없다(ai_conversations/
-- ai_messages, 0030) — 그러므로 여기서 건드릴 것이 없다.
--
-- 되돌리는 대상은 오직 0061(bigbrother_in_chat)이 chat_messages/
-- chat_conversations 에 얹은 것과, 0059(agent_runs, Big Brother 의 Agent
-- 탭 전용 상태)뿐이다. get_chat_messages/chat_message_fanout 은 0061 이후
-- reply/reaction(0046/0048) 위에 is_bot 분기를 더 얹은 상태이므로, "이전
-- 버전으로 되돌리기"가 아니라 **지금 모양에서 is_bot 관련 부분만 도려내는
-- 방식**으로 다시 정의한다 — reply/edited_at/reactions 는 그대로 유지된다.
--
-- sender_id 는 NOT NULL 로 되돌리지 않는다: 이미 봇이 초대돼 답한 대화가
-- 있다면 그 메시지 행은 sender_id 가 null 로 남아 있고, 이 마이그레이션은
-- 실제 운영 데이터를 지우거나 손대지 않는 원칙(이 세션 내내 지켜온 원칙)
-- 때문에 그 행들을 건드리지 않는다 — nullable 로 남겨 둬도 새 메시지는
-- 앱 로직상 항상 sender_id 를 채우므로 해가 없다.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- get_chat_messages — is_bot 출력 컬럼과 'Big Brother' 이름 분기만 제거.
-- 반환 컬럼 수가 바뀌므로 먼저 지운다(0061 이 했던 것과 같은 이유).
-- ---------------------------------------------------------------------------
drop function if exists public.get_chat_messages(uuid, integer);

create function public.get_chat_messages(p_conversation uuid, p_limit integer default 200)
returns table(id uuid, sender_id uuid, sender_name text, sender_avatar_url text, content text,
              created_at timestamptz, edited_at timestamptz, reply_to_id uuid,
              reply_to_sender_name text, reply_to_content text, reactions jsonb)
language sql
stable
security definer
set search_path = public
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
$$;

-- 0063 이 이미 한 번 겪은 문제(drop+create 가 grant 를 날린다) 재발 방지.
revoke all on function public.get_chat_messages(uuid, integer) from public, anon;
grant execute on function public.get_chat_messages(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- chat_message_fanout — is_bot 분기 제거, 항상 profiles 에서 이름을 읽는다.
-- ---------------------------------------------------------------------------
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
$$;

revoke all on function public.chat_message_fanout() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 봇 전용 함수/컬럼 제거
-- ---------------------------------------------------------------------------
drop function if exists public.set_bigbrother(uuid, boolean);
drop function if exists public.post_bigbrother_message(uuid, text);

alter table public.chat_conversations drop column if exists bigbrother_enabled;

alter table public.chat_messages drop constraint if exists chat_messages_sender_or_bot;
alter table public.chat_messages drop column if exists is_bot;

-- ---------------------------------------------------------------------------
-- Agent 탭(Antigravity 기반 전체 Code Space 편집) 전용 상태 — 탭 자체를
-- 지우므로 같이 지운다. 테이블을 지우면 그 위의 색인/정책/트리거는 함께
-- 사라진다.
-- ---------------------------------------------------------------------------
drop table if exists public.agent_runs;
