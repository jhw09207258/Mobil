-- 어시스턴트에게 보낸 첨부(이미지·PDF·링크·워크스페이스 파일).
--
-- 별도 테이블 대신 컬럼으로 두는 이유: 첨부는 항상 그 메시지와 함께 읽히고
-- 따로 조회할 일이 없다. 종류마다 필요한 필드가 달라 jsonb 가 적합하다.
--   [{kind:'image'|'document'|'link'|'workspace_file', name, path?, url?, mime?}]
alter table public.ai_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;
