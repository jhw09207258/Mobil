-- ============================================================================
-- claim_chat_push_recipients 가 이름값을 하게 만든다.
--
-- 0068 은 chat_members.last_push_at 을 **쓰기만** 하고 조건에서 읽지 않았다.
-- 그래서 같은 메시지로 두 번 청구하면 같은 사람이 두 번 나온다 — 즉 알림이
-- 두 번 간다. 평상시에는 sendChatMessage 가 메시지당 한 번만 부르니 드러나지
-- 않지만, 이 호출은 Next 의 after() 안에서 응답을 보낸 뒤에 돌기 때문에
-- 재시도(콜드 스타트 타임아웃, 배포 중 인스턴스 교체)가 실제로 일어난다.
-- 이메일 쪽(0062/0068)은 15분 쿨다운이 우연히 그 역할을 해 주고 있었지만,
-- 푸시는 "메시지마다 즉시" 가 정상 동작이라 쿨다운을 둘 수 없다.
--
-- 그래서 쿨다운 대신 **멱등성**으로 막는다. 기준을 시각이 아니라 메시지 자체로
-- 잡는 것이 핵심이다. 시각 비교(last_push_at < created_at)로도 될 것 같지만
-- 두 값이 같은 순간을 가리키는 경우가 실제로 있다 — 한 트랜잭션 안에서는
-- now() 가 고정이라 "보낸 시각 == 청구 시각" 이 되어, 뒤이은 진짜 메시지가
-- 조용히 삼켜진다. 알림을 두 번 보내는 것보다 안 보내는 쪽이 더 나쁘다.
--
-- 마지막으로 청구한 메시지 id 를 기억하면 두 성질을 정확히 얻는다.
--   * 같은 메시지 재청구 → 같은 id → 걸러진다.
--   * 다른(새) 메시지    → 다른 id → 시계와 무관하게 그대로 나간다.
-- 45초 "지금 보고 있는 중" 창과 push_notifications 설정은 그대로 둔다.
-- ============================================================================
alter table public.chat_members
  add column if not exists last_push_message uuid;

comment on column public.chat_members.last_push_message is
  '이 대화에서 마지막으로 푸시를 청구한 메시지. claim_chat_push_recipients 의 '
  '중복 발송 방지 기준 — 시각이 아니라 메시지 동일성으로 판단한다.';

comment on column public.chat_members.last_push_at is
  '이 대화에서 마지막으로 푸시를 보낸 시각. 진단용(설정 화면과 장애 추적).';

create or replace function public.claim_chat_push_recipients(p_message uuid)
returns table (user_id uuid, endpoint text, p256dh text, auth text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation uuid;
  v_sender uuid;
begin
  select conversation_id, sender_id into v_conversation, v_sender
    from public.chat_messages where id = p_message;

  if v_conversation is null then
    return;
  end if;
  -- 남의 메시지를 핑계로 다른 사람의 구독 주소를 긁어가지 못하게 막는다.
  if v_sender is null or v_sender is distinct from auth.uid() then
    return;
  end if;

  return query
  with claimed as (
    update public.chat_members m
       set last_push_at = now(),
           last_push_message = p_message
      from public.profiles p
     where m.conversation_id = v_conversation
       and m.user_id = p.id
       and m.user_id <> v_sender
       and p.push_notifications
       and m.last_read_at < now() - interval '45 seconds'
       -- 이 메시지는 이미 청구했다 — 다시 보내지 않는다.
       and m.last_push_message is distinct from p_message
    returning m.user_id
  )
  select s.user_id, s.endpoint, s.p256dh, s.auth
    from public.push_subscriptions s
    join claimed c on c.user_id = s.user_id;
end;
$$;

revoke all on function public.claim_chat_push_recipients(uuid) from public, anon;
grant execute on function public.claim_chat_push_recipients(uuid) to authenticated;
