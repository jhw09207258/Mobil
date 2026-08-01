-- ============================================================================
-- Sophia 제거 — AI 어시스턴트(/sophia) 기능 전체를 삭제한다.
-- ----------------------------------------------------------------------------
-- 0082 는 Big Brother 메뉴/봇만 지우고 Sophia(/sophia, ai_conversations 기반
-- 개인 채팅)는 완전히 별개로 남겨 뒀다. 이번엔 그 Sophia 자체를 지운다 —
-- 사용자가 이 기능을 원하지 않는다고 명시적으로 요청했다.
--
-- 지우는 것: ai_conversations/ai_messages/ai_conversation_plugins 세 테이블과
-- 그 위의 list_conversation_plugins() 하나. 셋 다 Sophia 전용 테이블임을
-- 앱 코드 감사로 확인했다(다른 기능이 쓰는 흔적 없음) — match_objects(헤더
-- 검색의 의미 검색)와 embeddings 생성 파이프라인은 Sophia 와 무관하게
-- 계속 쓰이므로 건드리지 않는다.
-- ============================================================================

drop table if exists public.ai_conversation_plugins;
drop table if exists public.ai_messages;
drop table if exists public.ai_conversations;

drop function if exists public.list_conversation_plugins(uuid);
