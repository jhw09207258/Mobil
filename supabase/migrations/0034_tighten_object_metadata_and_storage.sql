-- ============================================================================
-- 태그/링크 동기화 RPC 를 편집 권한 기준으로 강화 + 스토리지 버킷 상한 설정
-- ----------------------------------------------------------------------------
-- 1) sync_object_links/sync_object_tags 는 지금까지 can_view_object 로만
--    재검증했다. 열람 전용(view) 공유를 받은 사용자도 이 RPC 를 직접 호출하면
--    본문은 못 건드리면서 태그/링크 그래프는 마음대로 바꿀 수 있었다 — 이제
--    can_edit_object 로 교체한다. can_edit_object 는 0029/0031 에서 document/
--    code/sheet/mindmap 만 지원했으므로, sync_object_tags 가 쓰는 'file' 종류를
--    can_view_object 와 동일한 소유자/edit-permission/관리자 규칙으로 추가한다.
--
-- 2) files/media/avatars 버킷은 지금까지 크기·MIME 제한이 클라이언트 코드에만
--    있었다 — Storage API 를 직접 호출하면 무제한 업로드가 가능했다. 각 버킷의
--    실제 클라이언트 제한과 맞춰 서버 측 상한을 건다(files 는 범용 저장소라
--    MIME 은 제한하지 않고 용량만 제한).
-- ============================================================================

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
             or exists(select 1 from public.document_permissions dp where dp.document_id = d.id and dp.user_id = auth.uid() and dp.permission = 'edit')
             or public.is_admin())
    );
  elsif p_kind = 'code' then
    return exists(
      select 1 from public.code_files c
      where c.id = p_id
        and (c.owner_id = auth.uid()
             or exists(select 1 from public.code_file_permissions cp where cp.code_file_id = c.id and cp.user_id = auth.uid() and cp.permission = 'edit')
             or public.is_admin())
    );
  elsif p_kind = 'sheet' then
    return exists(
      select 1 from public.sheets s
      where s.id = p_id
        and (s.owner_id = auth.uid()
             or exists(select 1 from public.sheet_permissions sp where sp.sheet_id = s.id and sp.user_id = auth.uid() and sp.permission = 'edit')
             or public.is_admin())
    );
  elsif p_kind = 'mindmap' then
    return exists(
      select 1 from public.mind_maps m
      where m.id = p_id
        and (m.owner_id = auth.uid()
             or exists(select 1 from public.mind_map_permissions mp where mp.mind_map_id = m.id and mp.user_id = auth.uid() and mp.permission = 'edit')
             or public.is_admin())
    );
  elsif p_kind = 'file' then
    return exists(
      select 1 from public.files f
      where f.id = p_id
        and (f.owner_id = auth.uid()
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

create or replace function public.sync_object_links(
  p_source text,
  p_from_kind text,
  p_from_id uuid,
  p_links jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link jsonb;
begin
  if not public.can_edit_object(p_from_kind, p_from_id) then
    raise exception 'not_authorized';
  end if;

  delete from public.object_links where source = p_source;

  if p_links is null then
    return;
  end if;

  for v_link in select * from jsonb_array_elements(p_links) loop
    insert into public.object_links (source, from_kind, from_id, to_kind, to_id)
    values (p_source, p_from_kind, p_from_id, v_link->>'to_kind', (v_link->>'to_id')::uuid);
  end loop;
end;
$$;

create or replace function public.sync_object_tags(p_kind text, p_id uuid, p_tag_names text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tag_id uuid;
  v_name text;
  v_normalized text[];
begin
  if not public.can_edit_object(p_kind, p_id) then
    raise exception 'not_authorized';
  end if;

  delete from public.object_tags where kind = p_kind and object_id = p_id;

  if p_tag_names is null then
    return;
  end if;

  select array_agg(distinct lower(trim(t))) into v_normalized
    from unnest(p_tag_names) as t
    where length(trim(t)) > 0;

  if v_normalized is null then
    return;
  end if;

  foreach v_name in array v_normalized loop
    insert into public.tags (name) values (v_name)
      on conflict (name) do nothing;

    select id into v_tag_id from public.tags where name = v_name;

    insert into public.object_tags (tag_id, kind, object_id)
    values (v_tag_id, p_kind, p_id)
    on conflict do nothing;
  end loop;
end;
$$;

-- ---------- 스토리지 버킷 상한 ----------
-- files: 범용 저장소(임의 MIME) — 서버 측 상한이 없었으므로 100MB 로 제한.
update storage.buckets set file_size_limit = 104857600 where id = 'files';

-- media: 문서 임베드용 이미지/동영상 — 클라이언트 상한(50MB, image|video)과 맞춘다.
update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array['image/*', 'video/*']
where id = 'media';

-- avatars: 클라이언트 상한(5MB, image)과 맞춘다.
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/*']
where id = 'avatars';
