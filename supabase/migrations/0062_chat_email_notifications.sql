-- ============================================================================
-- 새 채팅 메시지 이메일 알림
-- ----------------------------------------------------------------------------
-- 채팅은 실시간으로만 도착해서, 앱을 안 보고 있으면 온 줄을 모른다. 가입한
-- 이메일로 한 통 보내 알린다.
--
-- 두 가지를 반드시 지켜야 한다.
--   1) 스팸이 되면 안 된다. 지금 대화를 보고 있는 사람(최근 읽음)에게는 보내지
--      않고, 같은 대화에 대해서는 일정 시간에 한 통만 보낸다.
--   2) 중복 발송이 없어야 한다. 두 메시지가 동시에 들어오면 두 요청이 같은
--      멤버를 동시에 "보낼 대상"으로 고를 수 있다. 그래서 대상 선정과
--      발송 기록을 하나의 UPDATE ... RETURNING 으로 묶는다 — 행 잠금이
--      직렬화를 보장하므로 한 쪽만 대상을 가져간다.
-- ============================================================================

-- 알림을 끌 수 있어야 한다. 기본은 켜짐 — 못 받는 것보다 받는 게 낫다.
alter table public.profiles
  add column if not exists email_chat_notifications boolean not null default true;

-- 이 대화에 대해 이 사람에게 마지막으로 메일을 보낸 시각. null 이면 보낸 적 없음.
alter table public.chat_members
  add column if not exists last_notified_at timestamptz;

-- 대화를 보고 있다고 볼 수 있는 시간. 이보다 최근에 읽었으면 메일을 안 보낸다.
-- 같은 대화에 대해 이 간격 안에는 한 통만 보낸다.
create or replace function public.claim_chat_email_recipients(p_message uuid)
returns table (user_id uuid, email text, display_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation uuid;
  v_sender uuid;
begin
  select conversation_id, sender_id
    into v_conversation, v_sender
    from public.chat_messages
   where id = p_message;

  if v_conversation is null then
    return;
  end if;

  -- 호출자는 그 메시지를 보낸 본인이어야 한다. SECURITY DEFINER 로 모든 멤버의
  -- 이메일을 볼 수 있는 함수이므로, 남의 메시지를 핑계로 명단을 긁어가지
  -- 못하게 여기서 막는다.
  if v_sender is null or v_sender is distinct from auth.uid() then
    return;
  end if;

  return query
  with claimed as (
    update public.chat_members m
       set last_notified_at = now()
      from public.profiles p
     where m.conversation_id = v_conversation
       and m.user_id = p.id
       and m.user_id <> v_sender
       and p.email_chat_notifications
       -- 방금 읽었으면 지금 보고 있는 중이다.
       and m.last_read_at < now() - interval '2 minutes'
       -- 같은 대화로 연달아 보내지 않는다.
       and (m.last_notified_at is null or m.last_notified_at < now() - interval '15 minutes')
    returning m.user_id, p.email, p.display_name
  )
  select c.user_id, c.email, c.display_name from claimed c;
end;
$$;

revoke all on function public.claim_chat_email_recipients(uuid) from public, anon;
grant execute on function public.claim_chat_email_recipients(uuid) to authenticated;
