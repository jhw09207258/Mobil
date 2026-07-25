-- ============================================================================
-- 휴지통 영구 삭제 시 부수 데이터까지 정리.
-- object_links / object_tags / object_embeddings 는 (kind, id) 다형 참조라
-- FK 캐스케이드가 없다 — 같이 지우지 않으면 고아 레코드가 남아 검색 인덱스와
-- 링크 그래프를 오염시킨다. (휴지통으로 "이동"할 때는 지우지 않는다 —
-- 복원했을 때 태그와 링크가 그대로 살아 있어야 하기 때문.)
-- ============================================================================
create or replace function public.purge_object_side_data(p_kind text, p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.object_links
  where (from_kind = p_kind and from_id = p_id)
     or (to_kind = p_kind and to_id = p_id);
  delete from public.object_embeddings where kind = p_kind and object_id = p_id;
  delete from public.object_tags where kind = p_kind and object_id = p_id;
$$;
revoke all on function public.purge_object_side_data(text, uuid) from public, anon, authenticated;

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
  perform public.purge_object_side_data(p_kind, p_id);
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
  r record;
begin
  for r in
    select 'document' as kind, id from public.documents  where deleted_at is not null and deleted_at < v_cutoff
    union all select 'code',    id from public.code_files where deleted_at is not null and deleted_at < v_cutoff
    union all select 'sheet',   id from public.sheets     where deleted_at is not null and deleted_at < v_cutoff
    union all select 'mindmap', id from public.mind_maps  where deleted_at is not null and deleted_at < v_cutoff
    union all select 'file',    id from public.files      where deleted_at is not null and deleted_at < v_cutoff
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

  return v_total;
end;
$$;
revoke all on function public.purge_expired_trash() from public, anon, authenticated;
