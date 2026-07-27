-- ============================================================================
-- 웹 푸시 알림 — 앱을 닫아 두어도 도착하는 알림
-- ----------------------------------------------------------------------------
-- 지금까지 "앱을 안 보고 있을 때" 알릴 방법이 가입 이메일 한 가지뿐이었다.
-- 메일은 늦고, 스팸함에 들어가고, 읽음 처리가 남고, 무엇보다 대화 하나에
-- 15분에 한 통이라 실시간 도구의 알림으로 쓰기엔 맞지 않는다.
--
-- 표준 웹 푸시(Push API + VAPID)로 바꾼다. 브라우저를 닫아도 OS 알림이 뜨고,
-- 홈 화면에 설치한 PWA(iOS 16.4+ 포함)와 데스크톱 앱에서도 같은 경로로 온다.
--
-- 이메일은 없애지 않고 **폴백으로 내린다** — 푸시를 구독하지 않았거나 푸시가
-- 실패한 사람에게만 나간다. 알림을 못 받는 사람이 생기는 것이 가장 나쁘다.
--
-- 구독 정보(endpoint/p256dh/auth)는 그 사람에게 알림을 보낼 수 있는 열쇠다.
-- RLS 로 본인만 읽고 쓰며, 남의 구독은 "이미 그 endpoint 를 아는 경우"에만
-- 만질 수 있다(아래 prune_push_subscription 주석 참고).
-- ============================================================================

-- 알림을 끌 수 있어야 한다. 기본은 켜짐 — 브라우저 권한이 한 겹 더 있으므로
-- 이 값이 켜져 있다고 해서 바로 알림이 가지는 않는다.
alter table public.profiles
  add column if not exists push_notifications boolean not null default true;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- 푸시 서비스가 준 주소. 이것 자체가 비밀에 가깝다(추측 불가능한 토큰 포함).
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  -- 어느 기기인지 사람이 알아볼 수 있게(설정 화면에서 해지할 때 필요).
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  -- 연속 실패 횟수. 일정 횟수를 넘기면 죽은 구독으로 보고 지운다.
  failure_count int not null default 0
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_select on public.push_subscriptions for select
using (user_id = (select auth.uid()));

create policy push_subscriptions_insert on public.push_subscriptions for insert
with check (user_id = (select auth.uid()));

create policy push_subscriptions_update on public.push_subscriptions for update
using (user_id = (select auth.uid()));

create policy push_subscriptions_delete on public.push_subscriptions for delete
using (user_id = (select auth.uid()));

-- 마지막으로 푸시를 보낸 시각 — 진단용(설정 화면과 장애 추적).
alter table public.chat_members
  add column if not exists last_push_at timestamptz;

-- ----------------------------------------------------------------------------
-- 새 채팅 메시지 → 푸시 대상 고르기
-- ----------------------------------------------------------------------------
-- 이메일(0062)과 두 가지가 다르다.
--   * 15분 쿨다운이 없다. 메시지마다 오는 것이 채팅 알림의 정상 동작이다.
--   * "지금 보고 있는" 판정 시간이 짧다(45초). 푸시는 즉시성이 전부라, 잠깐
--     자리를 비운 사이의 메시지를 놓치는 편이 더 나쁘다.
-- 중복 발송 방지는 이메일과 같은 원리로 UPDATE ... RETURNING 한 문장에 묶는다.
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
       set last_push_at = now()
      from public.profiles p
     where m.conversation_id = v_conversation
       and m.user_id = p.id
       and m.user_id <> v_sender
       and p.push_notifications
       and m.last_read_at < now() - interval '45 seconds'
    returning m.user_id
  )
  select s.user_id, s.endpoint, s.p256dh, s.auth
    from public.push_subscriptions s
    join claimed c on c.user_id = s.user_id;
end;
$$;

revoke all on function public.claim_chat_push_recipients(uuid) from public, anon;
grant execute on function public.claim_chat_push_recipients(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 이메일은 폴백으로 — 푸시가 나간 사람은 빼고 고른다.
-- 반환 컬럼이 그대로라도 인자가 바뀌면 새 함수이므로 옛 시그니처를 먼저 지운다.
-- ----------------------------------------------------------------------------
drop function if exists public.claim_chat_email_recipients(uuid);

create function public.claim_chat_email_recipients(
  p_message uuid,
  p_exclude uuid[] default '{}'
)
returns table (user_id uuid, email text, display_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation uuid;
  v_sender uuid;
  v_exclude uuid[] := coalesce(p_exclude, '{}');
begin
  select conversation_id, sender_id into v_conversation, v_sender
    from public.chat_messages where id = p_message;

  if v_conversation is null then
    return;
  end if;
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
       -- 푸시로 이미 알린 사람에게 메일까지 보내지 않는다.
       and not (m.user_id = any(v_exclude))
    returning m.user_id, p.email, p.display_name
  )
  select c.user_id, c.email, c.display_name from claimed c;
end;
$$;

revoke all on function public.claim_chat_email_recipients(uuid, uuid[]) from public, anon;
grant execute on function public.claim_chat_email_recipients(uuid, uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- 일정 초대 → 푸시 대상. 그 일정을 고칠 수 있는 사람(주최 쪽)만 부를 수 있다.
-- ----------------------------------------------------------------------------
create or replace function public.claim_event_push_recipients(
  p_event uuid,
  p_users uuid[] default null
)
returns table (user_id uuid, endpoint text, p256dh text, auth text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_edit_event(p_event) then
    return;
  end if;

  return query
  select s.user_id, s.endpoint, s.p256dh, s.auth
    from public.calendar_event_attendees a
    join public.profiles p on p.id = a.user_id
    join public.push_subscriptions s on s.user_id = a.user_id
   where a.event_id = p_event
     and a.user_id <> auth.uid()
     and a.response <> 'declined'
     and p.push_notifications
     and (p_users is null or a.user_id = any(p_users));
end;
$$;

revoke all on function public.claim_event_push_recipients(uuid, uuid[]) from public, anon;
grant execute on function public.claim_event_push_recipients(uuid, uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- 죽은 구독 정리.
--
-- 푸시 서비스가 404/410 을 주면 그 구독은 영영 못 쓴다. 그런데 그 응답을 받는
-- 쪽은 "보낸 사람"이지 "구독 주인"이 아니므로, RLS(본인만) 로는 지울 수 없다.
--
-- 그래서 id 가 아니라 **endpoint 문자열**을 키로 받는다. endpoint 는 푸시
-- 서비스가 발급한 추측 불가능한 토큰을 포함하고, 우리는 그것을 정당하게
-- claim 한 사람에게만 돌려준다 — 즉 이 함수를 부를 수 있다는 것은 이미 그
-- 구독으로 알림을 보낼 권한이 있었다는 뜻이다. 임의의 사용자가 남의 알림을
-- 끊으려면 endpoint 를 알아내야 하는데, 그건 이 함수 없이도 이미 알림을
-- 보낼 수 있다는 뜻이라 새로 열리는 권한이 없다.
-- ----------------------------------------------------------------------------
create or replace function public.prune_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_endpoint is null or char_length(p_endpoint) < 24 then
    return;
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
end;
$$;

revoke all on function public.prune_push_subscription(text) from public, anon;
grant execute on function public.prune_push_subscription(text) to authenticated;

-- 보내기에 성공하면 살아 있다는 표시를 남긴다(설정 화면의 "마지막 사용" 표기).
create or replace function public.touch_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.push_subscriptions
     set last_used_at = now(), failure_count = 0
   where endpoint = p_endpoint;
end;
$$;

revoke all on function public.touch_push_subscription(text) from public, anon;
grant execute on function public.touch_push_subscription(text) to authenticated;
