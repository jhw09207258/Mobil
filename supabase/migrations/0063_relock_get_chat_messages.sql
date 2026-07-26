-- ============================================================================
-- get_chat_messages 권한 재잠금 (드리프트 수정)
-- ----------------------------------------------------------------------------
-- 0061 이 반환 타입을 늘리며 `drop function` 후 `create function` 으로
-- 재정의했다(반환 타입 변경은 create or replace 로 안 된다). 문제는 drop+create
-- 가 기존 grant 를 지우고 Postgres 기본값(모두에게 execute 허용)으로
-- 되돌린다는 점 — 0046/0048 은 재정의 직후 revoke/grant 를 다시 걸어 이를
-- 막았지만, 0061 은 그 줄을 빠뜨렸다.
--
-- 결과: anon 이 이 함수를 실행할 수 있었다(has_function_privilege 로 확인,
-- 2026-07-26). is_chat_member() 가 auth.uid() = NULL 일 때 항상 false 를 주므로
-- 실제 데이터가 새지는 않았지만(빈 결과만 돌아옴), 의도한 방어선이 뚫려
-- 있었다 — is_chat_member 로직이 나중에 바뀌면 그대로 유출로 이어질 수 있는
-- 상태였다. 앞으로 반환 타입을 바꾸며 drop+create 를 다시 쓸 때는 재정의
-- 직후 항상 revoke/grant 를 재적용해야 한다.
-- ============================================================================
revoke all on function public.get_chat_messages(uuid, integer) from public, anon;
grant execute on function public.get_chat_messages(uuid, integer) to authenticated;
