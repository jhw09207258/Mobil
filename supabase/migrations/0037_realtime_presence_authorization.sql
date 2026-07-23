-- ============================================================================
-- 실시간 프레즌스("현재 접속 중인 사람") 채널 인가.
-- ----------------------------------------------------------------------------
-- realtime.messages 에는 extension 컬럼(broadcast/presence/postgres_changes)
-- 이 있는데, 지금까지 mobil_doc_code_broadcast_insert 정책은 extension 을
-- 구분하지 않고 모든 INSERT 에 realtime_topic_editable(편집 권한)을
-- 요구했다 — Yjs 업데이트 브로드캐스트 전송에는 맞는 요구지만, 프레즌스
-- track() 도 내부적으로 private 채널의 같은 INSERT 경로를 타므로 이대로
-- 두면 "보기 전용 사용자는 접속해 있어도 프레즌스 목록에 안 뜨는" 문제가
-- 생긴다.
--
-- 기존 정책을 extension = 'broadcast' 로 좁혀 원래 의도(콘텐츠 전송은 편집
-- 권한 필요)만 정확히 남기고, presence 전용 정책을 새로 추가해 "볼 수 있는
-- 사람은 누구나 자신의 접속 상태를 표시" 하도록 한다. SELECT 쪽은 이미
-- extension 무관하게 realtime_topic_viewable 만 확인하므로 프레즌스 수신
-- (다른 사람이 접속해 있는 걸 보는 것)은 그대로 동작 — 수정 불필요.
-- ============================================================================

drop policy if exists mobil_doc_code_broadcast_insert on realtime.messages;
create policy mobil_doc_code_broadcast_insert on realtime.messages for insert
with check (extension = 'broadcast' and public.realtime_topic_editable(topic));

drop policy if exists mobil_presence_insert on realtime.messages;
create policy mobil_presence_insert on realtime.messages for insert
with check (extension = 'presence' and public.realtime_topic_viewable(topic));
