-- ============================================================================
-- team_members_select 정책 — 행마다 다시 부르던 두 호출을 한 번만 부르게.
-- ----------------------------------------------------------------------------
-- Postgres 는 RLS 정책 식을 **행마다** 평가한다. 그래서 기존 정책의
--   (user_id = auth.uid()) or is_team_member(team_id)
--    or is_team_leader(team_id) or is_admin()
-- 에서 auth.uid() 와 is_admin() 은 행 값에 전혀 의존하지 않는데도 스캔하는
-- 행 수만큼 반복 호출됐다. is_admin() 은 안에서 profiles 를 다시 읽으므로
-- 팀원이 늘수록 이 낭비가 그대로 커진다(Supabase 성능 린터
-- auth_rls_initplan 이 지적한 항목).
--
-- 스칼라 서브쿼리로 감싸면 플래너가 InitPlan 으로 끌어올려 쿼리당 한 번만
-- 계산한다 — 결과는 완전히 같고 비용만 준다. 두 함수 모두 STABLE 이고 인자가
-- 없어(행에 의존하지 않아) 이 변환이 안전하다.
--
-- is_team_member(team_id)/is_team_leader(team_id) 는 각 행의 team_id 를 받으므로
-- 끌어올릴 수 없다 — 그대로 둔다.
-- ============================================================================
drop policy if exists team_members_select on public.team_members;

create policy team_members_select on public.team_members
  for select
  using (
    user_id = (select auth.uid())
    or public.is_team_member(team_id)
    or public.is_team_leader(team_id)
    or (select public.is_admin())
  );
