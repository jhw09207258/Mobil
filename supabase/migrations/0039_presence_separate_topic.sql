-- ============================================================================
-- 프레즌스("현재 접속자") 채널을 콘텐츠 채널과 다른 topic 으로 분리.
-- ----------------------------------------------------------------------------
-- 0037 에서 프레즌스를 콘텐츠와 "같은" topic(doc:<id> 등)에 얹었는데, Supabase
-- Realtime 은 한 클라이언트가 동일한 topic 으로 채널을 두 개 열면(하나는 Yjs
-- 브로드캐스트, 하나는 프레즌스) 같은 채널을 두 번 join 하는 꼴이 되어 충돌
-- 한다 — 결과적으로 문서/코드/마인드맵/시트의 실시간 동시편집(브로드캐스트)이
-- 프레즌스 채널과 부딪혀 조용히 끊긴다.
--
-- 해결: 프레즌스는 `presence:` 를 앞에 붙인 별도 topic(presence:doc:<id>)으로
-- 연다(lib/use-presence.ts). 그러면 콘텐츠(doc:<id>)와 topic 이 달라 충돌하지
-- 않는다. 다만 RLS 인가 함수는 topic 접두사로 종류를 판별하므로, realtime_
-- topic_viewable 이 `presence:` 접두사를 벗겨내고 원래 topic 기준으로 열람
-- 권한을 판정하도록 확장한다(프레즌스는 "볼 수 있으면 표시" — editable 은
-- 프레즌스에 필요 없으므로 realtime_topic_editable 은 그대로 둔다).
-- ============================================================================

create or replace function public.realtime_topic_viewable(p_topic text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  -- presence:<원래 topic> → 접두사(9글자)를 떼고 원래 topic 의 열람 권한으로 위임
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
  end if;
  return false;
exception when others then
  return false;
end;
$$;
