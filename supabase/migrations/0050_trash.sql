-- ============================================================================
-- 휴지통(Trash) — 삭제를 영구 삭제가 아니라 "18시간 보관 후 자동 삭제"로.
-- ----------------------------------------------------------------------------
-- 설계 원칙: 숨기는 책임을 RLS SELECT 정책에 둔다.
--   목록·검색 RPC·대시보드 집계·저장소 내용·첨부 픽커 등 읽는 곳이 수십
--   군데라 애플리케이션 쿼리마다 `deleted_at is null` 을 붙이는 방식은 하나만
--   빠뜨려도 지운 항목이 다시 보인다. 정책에서 한 번 막으면 모든 경로가
--   자동으로 안전해진다(fail-closed).
--   대신 휴지통 자체는 그 정책을 우회해야 하므로 SECURITY DEFINER RPC 로
--   조회/복원/즉시삭제를 제공하고, 각 함수가 소유자 여부를 직접 확인한다.
-- ============================================================================

alter table public.documents  add column if not exists deleted_at timestamptz;
alter table public.code_files add column if not exists deleted_at timestamptz;
alter table public.sheets     add column if not exists deleted_at timestamptz;
alter table public.mind_maps  add column if not exists deleted_at timestamptz;
alter table public.files      add column if not exists deleted_at timestamptz;

-- 휴지통 조회/자동 정리는 "지워진 것"만 훑으므로 부분 인덱스로 충분하다.
create index if not exists documents_trash_idx  on public.documents  (deleted_at) where deleted_at is not null;
create index if not exists code_files_trash_idx on public.code_files (deleted_at) where deleted_at is not null;
create index if not exists sheets_trash_idx     on public.sheets     (deleted_at) where deleted_at is not null;
create index if not exists mind_maps_trash_idx  on public.mind_maps  (deleted_at) where deleted_at is not null;
create index if not exists files_trash_idx      on public.files      (deleted_at) where deleted_at is not null;

-- ---------------------------------------------------------------------------
-- SELECT 정책 — 기존 판정에 "휴지통에 없을 것"을 AND 로 덧붙인다.
-- (권한 논리는 그대로. auth.uid() 는 이미 (select ...) 로 감싸져 있다.)
-- ---------------------------------------------------------------------------
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select
using (
  deleted_at is null and (
    owner_id = (select auth.uid())
    or is_public = true
    or exists (
      select 1 from public.document_permissions dp
      where dp.document_id = documents.id and dp.user_id = (select auth.uid())
    )
    or public.is_admin()
  )
);

drop policy if exists code_files_select on public.code_files;
create policy code_files_select on public.code_files for select
using (
  deleted_at is null and (
    owner_id = (select auth.uid())
    or is_public = true
    or exists (
      select 1 from public.code_file_permissions cp
      where cp.code_file_id = code_files.id and cp.user_id = (select auth.uid())
    )
    or public.is_admin()
  )
);

drop policy if exists sheets_select on public.sheets;
create policy sheets_select on public.sheets for select
using (
  deleted_at is null and (
    owner_id = (select auth.uid())
    or is_public = true
    or exists (
      select 1 from public.sheet_permissions sp
      where sp.sheet_id = sheets.id and sp.user_id = (select auth.uid())
    )
    or public.is_admin()
  )
);

drop policy if exists mind_maps_select on public.mind_maps;
create policy mind_maps_select on public.mind_maps for select
using (
  deleted_at is null and (
    owner_id = (select auth.uid())
    or is_public = true
    or exists (
      select 1 from public.mind_map_permissions mp
      where mp.mind_map_id = mind_maps.id and mp.user_id = (select auth.uid())
    )
    or public.is_admin()
  )
);

drop policy if exists files_select on public.files;
create policy files_select on public.files for select
using (
  deleted_at is null and (
    owner_id = (select auth.uid())
    or is_public = true
    or exists (
      select 1 from public.file_permissions fp
      where fp.file_id = files.id and fp.user_id = (select auth.uid())
    )
    or public.is_admin()
  )
);

-- ---------------------------------------------------------------------------
-- 소유자 확인 헬퍼 — 휴지통 RPC 들이 공통으로 쓴다. 삭제/복원은 편집 권한이
-- 아니라 "소유자(또는 관리자)"만 할 수 있다(기존 DELETE 정책과 동일한 기준).
-- ---------------------------------------------------------------------------
create or replace function public.trash_owns(p_kind text, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare v_owner uuid;
begin
  select owner_id into v_owner from public.documents  where id = p_id and p_kind = 'document';
  if v_owner is null then select owner_id into v_owner from public.code_files where id = p_id and p_kind = 'code'; end if;
  if v_owner is null then select owner_id into v_owner from public.sheets     where id = p_id and p_kind = 'sheet'; end if;
  if v_owner is null then select owner_id into v_owner from public.mind_maps  where id = p_id and p_kind = 'mindmap'; end if;
  if v_owner is null then select owner_id into v_owner from public.files      where id = p_id and p_kind = 'file'; end if;
  return v_owner is not null and (v_owner = auth.uid() or public.is_admin());
end;
$$;
revoke all on function public.trash_owns(text, uuid) from public, anon, authenticated;

-- 휴지통으로 이동
create or replace function public.move_to_trash(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.trash_owns(p_kind, p_id) then
    raise exception 'Only the owner can delete this item';
  end if;
  if    p_kind = 'document' then update public.documents  set deleted_at = now() where id = p_id;
  elsif p_kind = 'code'     then update public.code_files set deleted_at = now() where id = p_id;
  elsif p_kind = 'sheet'    then update public.sheets     set deleted_at = now() where id = p_id;
  elsif p_kind = 'mindmap'  then update public.mind_maps  set deleted_at = now() where id = p_id;
  elsif p_kind = 'file'     then update public.files      set deleted_at = now() where id = p_id;
  else raise exception 'Unknown kind %', p_kind;
  end if;
end;
$$;
revoke all on function public.move_to_trash(text, uuid) from public, anon;
grant execute on function public.move_to_trash(text, uuid) to authenticated;

-- 복원
create or replace function public.restore_from_trash(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.trash_owns(p_kind, p_id) then
    raise exception 'Only the owner can restore this item';
  end if;
  if    p_kind = 'document' then update public.documents  set deleted_at = null where id = p_id;
  elsif p_kind = 'code'     then update public.code_files set deleted_at = null where id = p_id;
  elsif p_kind = 'sheet'    then update public.sheets     set deleted_at = null where id = p_id;
  elsif p_kind = 'mindmap'  then update public.mind_maps  set deleted_at = null where id = p_id;
  elsif p_kind = 'file'     then update public.files      set deleted_at = null where id = p_id;
  else raise exception 'Unknown kind %', p_kind;
  end if;
end;
$$;
revoke all on function public.restore_from_trash(text, uuid) from public, anon;
grant execute on function public.restore_from_trash(text, uuid) to authenticated;

-- 즉시 영구 삭제(휴지통에서 "지금 비우기")
create or replace function public.purge_trash_item(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.trash_owns(p_kind, p_id) then
    raise exception 'Only the owner can purge this item';
  end if;
  if    p_kind = 'document' then delete from public.documents  where id = p_id and deleted_at is not null;
  elsif p_kind = 'code'     then delete from public.code_files where id = p_id and deleted_at is not null;
  elsif p_kind = 'sheet'    then delete from public.sheets     where id = p_id and deleted_at is not null;
  elsif p_kind = 'mindmap'  then delete from public.mind_maps  where id = p_id and deleted_at is not null;
  elsif p_kind = 'file'     then delete from public.files      where id = p_id and deleted_at is not null;
  else raise exception 'Unknown kind %', p_kind;
  end if;
end;
$$;
revoke all on function public.purge_trash_item(text, uuid) from public, anon;
grant execute on function public.purge_trash_item(text, uuid) to authenticated;

-- 내 휴지통 목록 — SELECT 정책이 가리므로 SECURITY DEFINER 로 직접 읽는다.
create or replace function public.list_trash()
returns table (
  kind text,
  id uuid,
  title text,
  deleted_at timestamptz,
  expires_at timestamptz,
  storage_path text
)
language sql
security definer
set search_path = public
stable
as $$
  select 'document', d.id, coalesce(nullif(d.title,''),'Untitled'), d.deleted_at,
         d.deleted_at + interval '18 hours', null::text
  from public.documents d where d.deleted_at is not null and d.owner_id = auth.uid()
  union all
  select 'code', c.id, coalesce(nullif(c.name,''),'Untitled'), c.deleted_at,
         c.deleted_at + interval '18 hours', null::text
  from public.code_files c where c.deleted_at is not null and c.owner_id = auth.uid()
  union all
  select 'sheet', s.id, coalesce(nullif(s.title,''),'Untitled'), s.deleted_at,
         s.deleted_at + interval '18 hours', null::text
  from public.sheets s where s.deleted_at is not null and s.owner_id = auth.uid()
  union all
  select 'mindmap', m.id, coalesce(nullif(m.title,''),'Untitled'), m.deleted_at,
         m.deleted_at + interval '18 hours', null::text
  from public.mind_maps m where m.deleted_at is not null and m.owner_id = auth.uid()
  union all
  select 'file', f.id, f.file_name, f.deleted_at,
         f.deleted_at + interval '18 hours', f.storage_path
  from public.files f where f.deleted_at is not null and f.owner_id = auth.uid()
  order by 4 desc;
$$;
revoke all on function public.list_trash() from public, anon;
grant execute on function public.list_trash() to authenticated;

-- ---------------------------------------------------------------------------
-- 18시간 지난 항목 영구 삭제. pg_cron 이 주기적으로 부른다.
-- 파일은 DB 행보다 먼저 storage.objects 를 지워야 스토리지에 고아 객체가
-- 남지 않는다(경로를 잃어버리면 되찾을 방법이 없다).
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired_trash()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - interval '18 hours';
  v_total integer := 0;
  v_n integer;
begin
  delete from storage.objects o
  using public.files f
  where f.deleted_at is not null and f.deleted_at < v_cutoff
    and o.bucket_id = 'files' and o.name = f.storage_path;

  delete from public.files where deleted_at is not null and deleted_at < v_cutoff;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  delete from public.documents where deleted_at is not null and deleted_at < v_cutoff;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  delete from public.code_files where deleted_at is not null and deleted_at < v_cutoff;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  delete from public.sheets where deleted_at is not null and deleted_at < v_cutoff;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  delete from public.mind_maps where deleted_at is not null and deleted_at < v_cutoff;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  return v_total;
end;
$$;
revoke all on function public.purge_expired_trash() from public, anon, authenticated;
