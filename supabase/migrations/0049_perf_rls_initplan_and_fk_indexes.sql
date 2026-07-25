-- ============================================================================
-- 성능 정리 — Supabase advisor 가 지적한 두 가지.
-- ----------------------------------------------------------------------------
-- 1) auth_rls_initplan: 정책 안에서 auth.uid() 를 그대로 부르면 행마다 다시
--    평가된다. (select auth.uid()) 로 감싸면 쿼리당 한 번만 계산되는
--    InitPlan 이 되어 행이 많아질수록 차이가 커진다. SELECT/DELETE 정책 일부는
--    이미 그렇게 되어 있는데 UPDATE 쪽과 files_delete 만 빠져 있었다.
--    ※ 판정 논리는 한 글자도 바꾸지 않는다 — 평가 횟수만 줄이는 리팩터.
-- 2) unindexed_foreign_keys: FK 컬럼에 커버링 인덱스가 없으면 참조 무결성
--    검사와 조인이 순차 스캔이 된다. 특히 chat_messages(sender_id,
--    reply_to_id) 는 메시지가 쌓일수록 체감된다.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) RLS InitPlan
-- ---------------------------------------------------------------------------
drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents for update
using (
  owner_id = (select auth.uid())
  or is_public = true
  or exists (
    select 1 from public.document_permissions dp
    where dp.document_id = documents.id
      and dp.user_id = (select auth.uid())
      and dp.permission = 'edit'
  )
  or public.is_admin()
);

drop policy if exists code_files_update on public.code_files;
create policy code_files_update on public.code_files for update
using (
  owner_id = (select auth.uid())
  or is_public = true
  or exists (
    select 1 from public.code_file_permissions cp
    where cp.code_file_id = code_files.id
      and cp.user_id = (select auth.uid())
      and cp.permission = 'edit'
  )
  or public.is_admin()
);

drop policy if exists sheets_update on public.sheets;
create policy sheets_update on public.sheets for update
using (
  owner_id = (select auth.uid())
  or is_public = true
  or exists (
    select 1 from public.sheet_permissions sp
    where sp.sheet_id = sheets.id
      and sp.user_id = (select auth.uid())
      and sp.permission = 'edit'
  )
  or public.is_admin()
);

drop policy if exists mind_maps_update on public.mind_maps;
create policy mind_maps_update on public.mind_maps for update
using (
  owner_id = (select auth.uid())
  or is_public = true
  or exists (
    select 1 from public.mind_map_permissions mp
    where mp.mind_map_id = mind_maps.id
      and mp.user_id = (select auth.uid())
      and mp.permission = 'edit'
  )
  or public.is_admin()
);

drop policy if exists files_update on public.files;
create policy files_update on public.files for update
using (
  owner_id = (select auth.uid())
  or is_public = true
  or exists (
    select 1 from public.file_permissions fp
    where fp.file_id = files.id
      and fp.user_id = (select auth.uid())
      and fp.permission = 'edit'
  )
  or public.is_admin()
);

drop policy if exists files_delete on public.files;
create policy files_delete on public.files for delete
using (
  owner_id = (select auth.uid())
  or is_public = true
  or public.is_admin()
);

-- ---------------------------------------------------------------------------
-- 2) FK 커버링 인덱스
-- ---------------------------------------------------------------------------
create index if not exists admin_codes_used_by_idx on public.admin_codes (used_by);
create index if not exists audit_logs_user_idx on public.audit_logs (user_id);
create index if not exists chat_conversations_created_by_idx on public.chat_conversations (created_by);
create index if not exists chat_message_reactions_user_idx on public.chat_message_reactions (user_id);
create index if not exists chat_messages_sender_idx on public.chat_messages (sender_id);
create index if not exists chat_messages_reply_to_idx on public.chat_messages (reply_to_id);
create index if not exists code_file_permissions_user_idx on public.code_file_permissions (user_id);
create index if not exists code_file_permissions_granted_by_idx on public.code_file_permissions (granted_by);
create index if not exists content_contributors_user_idx on public.content_contributors (user_id);
create index if not exists document_activity_user_idx on public.document_activity (user_id);
create index if not exists document_permissions_user_idx on public.document_permissions (user_id);
create index if not exists document_permissions_granted_by_idx on public.document_permissions (granted_by);
create index if not exists file_permissions_user_idx on public.file_permissions (user_id);
create index if not exists file_permissions_granted_by_idx on public.file_permissions (granted_by);
create index if not exists mind_map_permissions_user_idx on public.mind_map_permissions (user_id);
create index if not exists mind_map_permissions_granted_by_idx on public.mind_map_permissions (granted_by);
create index if not exists profiles_approved_by_idx on public.profiles (approved_by);
create index if not exists sheet_permissions_user_idx on public.sheet_permissions (user_id);
create index if not exists sheet_permissions_granted_by_idx on public.sheet_permissions (granted_by);
