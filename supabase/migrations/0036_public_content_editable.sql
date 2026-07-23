-- ============================================================================
-- 공개(is_public) 문서/코드/시트/마인드맵/파일을 관리자가 아닌 일반 사용자도
-- 편집할 수 있게 허용.
-- ----------------------------------------------------------------------------
-- 지금까지 *_update 정책은 owner_id / *_permissions(edit) / is_admin() 만
-- 봤다 — is_public 은 SELECT(열람) 정책에만 들어 있고 UPDATE 정책에는 전혀
-- 없었다. 그 결과 "공개로 전환된" 문서/시트/마인드맵/코드 파일이라도 소유자·
-- 명시적 edit 공유자·관리자가 아니면 열람만 되고 수정은 막혔다 — 실제로
-- 의도한 "누구나 볼 수 있고 고칠 수 있는 공개 문서"가 아니었다.
--
-- files 는 그중에서도 유독 더 좁았다: *_permissions 의 edit grant 조차 보지
-- 않고 owner/admin 만 update 가능했다(document/code/sheet/mindmap 은 이미
-- edit 공유를 봤음) — can_edit_object('file', ...)(0034) 와도 어긋나 있던
-- 기존 불일치를 이번에 함께 맞춘다. files 는 사용자 요청에 따라 삭제까지도
-- 공개 편집 대상에 포함한다(문서/코드/시트/마인드맵은 본문만 — 삭제는 계속
-- 소유자/관리자 전용으로 남긴다, 원 요청이 "수정"이었으므로).
-- ============================================================================

-- ---------- documents ----------
drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents for update
using (
  owner_id = auth.uid()
  or is_public = true
  or exists (select 1 from public.document_permissions dp where dp.document_id = documents.id and dp.user_id = auth.uid() and dp.permission = 'edit')
  or public.is_admin()
);

-- ---------- code_files ----------
drop policy if exists code_files_update on public.code_files;
create policy code_files_update on public.code_files for update
using (
  owner_id = auth.uid()
  or is_public = true
  or exists (select 1 from public.code_file_permissions cp where cp.code_file_id = code_files.id and cp.user_id = auth.uid() and cp.permission = 'edit')
  or public.is_admin()
);

-- ---------- sheets ----------
drop policy if exists sheets_update on public.sheets;
create policy sheets_update on public.sheets for update
using (
  owner_id = auth.uid()
  or is_public = true
  or exists (select 1 from public.sheet_permissions sp where sp.sheet_id = sheets.id and sp.user_id = auth.uid() and sp.permission = 'edit')
  or public.is_admin()
);

-- ---------- mind_maps ----------
drop policy if exists mind_maps_update on public.mind_maps;
create policy mind_maps_update on public.mind_maps for update
using (
  owner_id = auth.uid()
  or is_public = true
  or exists (select 1 from public.mind_map_permissions mp where mp.mind_map_id = mind_maps.id and mp.user_id = auth.uid() and mp.permission = 'edit')
  or public.is_admin()
);

-- ---------- files (메타데이터 테이블) ----------
-- is_public 추가 + 기존에 빠져 있던 file_permissions(edit) 체크도 함께 추가.
-- 삭제도 공개 대상에 포함(사용자 요청).
drop policy if exists files_update on public.files;
create policy files_update on public.files for update
using (
  owner_id = auth.uid()
  or is_public = true
  or exists (select 1 from public.file_permissions fp where fp.file_id = files.id and fp.user_id = auth.uid() and fp.permission = 'edit')
  or public.is_admin()
);

drop policy if exists files_delete on public.files;
create policy files_delete on public.files for delete
using (
  owner_id = auth.uid()
  or is_public = true
  or public.is_admin()
);

-- ---------- storage.objects (files 버킷 실제 바이너리) ----------
-- select: 지금까지 is_public 을 전혀 안 봐서, 공개로 표시된 파일도 명시적
-- file_permissions 행이 없는 사용자는 서명 URL 발급(getSignedUrl)이 RLS 에
-- 막혀 다운로드 자체가 실패했다 — files 테이블 조회(목록)는 되는데 실제
-- 바이트 접근만 막히는 불일치였다.
drop policy if exists storage_files_select on storage.objects;
create policy storage_files_select on storage.objects for select
using (
  bucket_id = 'files'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1 from public.files f
      where f.storage_path = objects.name and f.is_public = true
    )
    or exists (
      select 1 from public.files f
      join public.file_permissions fp on fp.file_id = f.id
      where f.storage_path = objects.name and fp.user_id = auth.uid()
    )
    or public.is_admin()
  )
);

-- delete: files 테이블의 delete 를 공개 대상으로 열어도, 실제 스토리지
-- 오브젝트 삭제가 여기서 막히면 의미가 없다 — 동일한 규칙으로 확장한다.
drop policy if exists storage_files_delete on storage.objects;
create policy storage_files_delete on storage.objects for delete
using (
  bucket_id = 'files'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
    or exists (
      select 1 from public.files f
      where f.storage_path = objects.name
        and (
          f.is_public = true
          or exists (select 1 from public.file_permissions fp where fp.file_id = f.id and fp.user_id = auth.uid() and fp.permission = 'edit')
        )
    )
  )
);

-- ---------- can_edit_object() ----------
-- 실시간 브로드캐스트 인가(realtime_topic_editable)와 sync_object_links/
-- sync_object_tags RPC 가 재사용하는 함수 — 테이블 UPDATE 정책과 어긋나면
-- "저장은 되는데 실시간 동시편집 전송이나 태그 동기화만 조용히 막히는"
-- 불일치가 생기므로 반드시 함께 고친다.
create or replace function public.can_edit_object(p_kind text, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if p_kind = 'document' then
    return exists(
      select 1 from public.documents d
      where d.id = p_id
        and (d.owner_id = auth.uid()
             or d.is_public = true
             or exists(select 1 from public.document_permissions dp where dp.document_id = d.id and dp.user_id = auth.uid() and dp.permission = 'edit')
             or public.is_admin())
    );
  elsif p_kind = 'code' then
    return exists(
      select 1 from public.code_files c
      where c.id = p_id
        and (c.owner_id = auth.uid()
             or c.is_public = true
             or exists(select 1 from public.code_file_permissions cp where cp.code_file_id = c.id and cp.user_id = auth.uid() and cp.permission = 'edit')
             or public.is_admin())
    );
  elsif p_kind = 'sheet' then
    return exists(
      select 1 from public.sheets s
      where s.id = p_id
        and (s.owner_id = auth.uid()
             or s.is_public = true
             or exists(select 1 from public.sheet_permissions sp where sp.sheet_id = s.id and sp.user_id = auth.uid() and sp.permission = 'edit')
             or public.is_admin())
    );
  elsif p_kind = 'mindmap' then
    return exists(
      select 1 from public.mind_maps m
      where m.id = p_id
        and (m.owner_id = auth.uid()
             or m.is_public = true
             or exists(select 1 from public.mind_map_permissions mp where mp.mind_map_id = m.id and mp.user_id = auth.uid() and mp.permission = 'edit')
             or public.is_admin())
    );
  elsif p_kind = 'file' then
    return exists(
      select 1 from public.files f
      where f.id = p_id
        and (f.owner_id = auth.uid()
             or f.is_public = true
             or exists(select 1 from public.file_permissions fp where fp.file_id = f.id and fp.user_id = auth.uid() and fp.permission = 'edit')
             or public.is_admin())
    );
  else
    return false;
  end if;
end;
$$;

revoke all on function public.can_edit_object(text, uuid) from public, anon;
grant execute on function public.can_edit_object(text, uuid) to authenticated;
