-- ============================================================================
-- Code Space 의 휴지통 수명주기 — 세 가지 구멍을 메운다.
--
-- 1) code_repository_id 를 NOT NULL 로 바꾸면서(0055) FK 의 ON DELETE SET NULL
--    이 자기모순이 됐다: Space 를 지우려 하면 NULL 을 넣다가 제약 위반으로
--    실패한다. Space 가 없으면 파일도 없는 게 맞으니 CASCADE 로 바꾼다.
-- 2) 삭제한 Code Space 가 list_trash 에 아예 없어서 영영 복원할 수 없었다.
-- 3) 파일만 복원하면 소속 Space 는 삭제 상태 그대로라, 휴지통에도 없고 어느
--    Code Space 에도 안 보이는 유령 파일이 됐다.
-- 덤으로 purge_expired_trash 가 code_repositories 를 지우지 않아 만료된 Space 가
-- 영원히 쌓이던 것도 고친다.
--
-- 라이브 DB 에서 왕복 검증함(트랜잭션 후 롤백): Space 삭제 → 파일 동반 삭제 →
-- 파일 복원 시 Space 동반 복원 → Space 실삭제 시 파일 CASCADE.
-- ============================================================================

-- 1. FK: NOT NULL 과 ON DELETE SET NULL 이 공존할 수 없다.
alter table public.code_files
  drop constraint if exists code_files_code_repository_id_fkey;
alter table public.code_files
  add constraint code_files_code_repository_id_fkey
  foreign key (code_repository_id) references public.code_repositories(id) on delete cascade;

-- 2. 소유자 판정에 code_space 추가.
create or replace function public.trash_owns(p_kind text, p_id uuid)
returns boolean language plpgsql stable security definer set search_path to 'public' as $function$
declare v_owner uuid;
begin
  select owner_id into v_owner from public.documents  where id = p_id and p_kind = 'document';
  if v_owner is null then select owner_id into v_owner from public.code_files where id = p_id and p_kind = 'code'; end if;
  if v_owner is null then select owner_id into v_owner from public.sheets     where id = p_id and p_kind = 'sheet'; end if;
  if v_owner is null then select owner_id into v_owner from public.mind_maps  where id = p_id and p_kind = 'mindmap'; end if;
  if v_owner is null then select owner_id into v_owner from public.files      where id = p_id and p_kind = 'file'; end if;
  if v_owner is null then select owner_id into v_owner from public.code_repositories where id = p_id and p_kind = 'code_space'; end if;
  return v_owner is not null and (v_owner = auth.uid() or public.is_admin());
end;
$function$;

create or replace function public.move_to_trash(p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public.trash_owns(p_kind, p_id) then
    raise exception 'Only the owner can delete this item';
  end if;
  if    p_kind = 'document'   then update public.documents  set deleted_at = now() where id = p_id;
  elsif p_kind = 'code'       then update public.code_files set deleted_at = now() where id = p_id;
  elsif p_kind = 'sheet'      then update public.sheets     set deleted_at = now() where id = p_id;
  elsif p_kind = 'mindmap'    then update public.mind_maps  set deleted_at = now() where id = p_id;
  elsif p_kind = 'file'       then update public.files      set deleted_at = now() where id = p_id;
  elsif p_kind = 'code_space' then
    update public.code_repositories set deleted_at = now() where id = p_id;
    update public.code_files set deleted_at = now()
      where code_repository_id = p_id and deleted_at is null;
  else raise exception 'Unknown kind %', p_kind;
  end if;
end;
$function$;

-- 3. 복원. 코드 파일을 되살릴 때 소속 Space 가 삭제 상태면 같이 되살린다 —
--    안 그러면 휴지통에도 없고 어디에도 안 보이는 유령이 된다.
create or replace function public.restore_from_trash(p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_space uuid;
begin
  if not public.trash_owns(p_kind, p_id) then
    raise exception 'Only the owner can restore this item';
  end if;
  if    p_kind = 'document' then update public.documents  set deleted_at = null where id = p_id;
  elsif p_kind = 'sheet'    then update public.sheets     set deleted_at = null where id = p_id;
  elsif p_kind = 'mindmap'  then update public.mind_maps  set deleted_at = null where id = p_id;
  elsif p_kind = 'file'     then update public.files      set deleted_at = null where id = p_id;
  elsif p_kind = 'code'     then
    select code_repository_id into v_space from public.code_files where id = p_id;
    update public.code_files set deleted_at = null where id = p_id;
    update public.code_repositories set deleted_at = null
      where id = v_space and deleted_at is not null;
  elsif p_kind = 'code_space' then
    update public.code_repositories set deleted_at = null where id = p_id;
    update public.code_files set deleted_at = null where code_repository_id = p_id;
  else raise exception 'Unknown kind %', p_kind;
  end if;
end;
$function$;

-- 4. 목록에 Code Space 추가(지금까지 안 보여서 복원이 불가능했다).
create or replace function public.list_trash()
returns table(kind text, id uuid, title text, deleted_at timestamptz, expires_at timestamptz, storage_path text)
language sql stable security definer set search_path to 'public' as $function$
  select 'document', d.id, coalesce(nullif(d.title,''),'Untitled'), d.deleted_at,
         d.deleted_at + interval '18 hours', null::text
  from public.documents d where d.deleted_at is not null and d.owner_id = auth.uid()
  union all
  select 'code', c.id, coalesce(nullif(c.path, c.name),'Untitled'), c.deleted_at,
         c.deleted_at + interval '18 hours', null::text
  from public.code_files c where c.deleted_at is not null and c.owner_id = auth.uid()
  union all
  select 'code_space', r.id, coalesce(nullif(r.name,''),'Untitled'), r.deleted_at,
         r.deleted_at + interval '18 hours', null::text
  from public.code_repositories r where r.deleted_at is not null and r.owner_id = auth.uid()
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
$function$;

-- 5. 만료 삭제에 Code Space 포함(안 그러면 영원히 쌓인다).
create or replace function public.purge_expired_trash()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  v_cutoff timestamptz := now() - interval '18 hours';
  v_total integer := 0;
  v_n integer;
  r record;
begin
  for r in
    select 'document' as kind, id from public.documents  where deleted_at is not null and deleted_at < v_cutoff
    union all select 'code',    id from public.code_files where deleted_at is not null and deleted_at < v_cutoff
    union all select 'sheet',   id from public.sheets     where deleted_at is not null and deleted_at < v_cutoff
    union all select 'mindmap', id from public.mind_maps  where deleted_at is not null and deleted_at < v_cutoff
    union all select 'file',    id from public.files      where deleted_at is not null and deleted_at < v_cutoff
    -- 만료된 Space 와 함께 CASCADE 로 사라질 파일들의 부수 데이터도 미리 정리.
    union all select 'code',    c.id from public.code_files c
      join public.code_repositories r2 on r2.id = c.code_repository_id
      where r2.deleted_at is not null and r2.deleted_at < v_cutoff
  loop
    perform public.purge_object_side_data(r.kind, r.id);
  end loop;

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
  delete from public.code_repositories where deleted_at is not null and deleted_at < v_cutoff;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  return v_total;
end;
$function$;
