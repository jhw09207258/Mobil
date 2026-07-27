-- ============================================================================
-- 채팅으로 자료 공유 — 권한까지 함께 넘긴다
-- ----------------------------------------------------------------------------
-- 지금까지 채팅 첨부(⛓)는 "이 문서를 보라"는 링크에 지나지 않았다. 받는 쪽에
-- 권한이 없으면 칩을 눌러도 열리지 않아서, 결국 사람이 말로 "파일 진입 경로"를
-- 불러 주는 상황이 반복됐다. 링크를 보낸다는 것은 곧 "너도 볼 수 있어야
-- 한다"는 뜻이므로, 첨부와 권한 부여를 하나의 동작으로 묶는다.
--
--   1) grant_object_access        — 소유자/관리자가 한 사람에게 권한을 준다.
--   2) share_object_with_conversation — 그 대화의 모든 멤버에게 한 번에 준다.
--   3) get_object_cards           — 첨부 칩을 카드로 그리는 데 필요한 메타데이터를
--                                   여러 개 한 번에(칩 개수만큼 쿼리하지 않게).
--   4) request_object_access      — 권한이 없을 때 소유자에게 요청할 수 있게
--                                   소유자를 알려 준다(제목은 알려 주지 않는다).
--
-- 설계 원칙
--   * 권한을 줄 수 있는 사람은 소유자와 관리자뿐이다. edit 공유를 받은 사람이
--     제3자에게 다시 뿌리는 경로는 만들지 않는다(재공유는 소유자의 결정).
--   * 권한을 못 주는 사람도 첨부 자체는 할 수 있다. 그때 받는 쪽 카드는
--     "권한 없음 — 요청하기" 상태로 보이고, 소유자가 그 대화에 들어와 있으면
--     카드에서 바로 "이 대화에 공유" 를 누를 수 있다.
--   * 이미 더 센 권한(edit)이 있는데 view 를 주면서 내려깎지 않는다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) 소유자 조회 헬퍼 — 휴지통에 있는 항목은 없는 것으로 본다.
--    아래 함수들은 전부 SECURITY DEFINER 라 RLS 의 `deleted_at is null` 조건이
--    적용되지 않는다. 삭제된 자료의 권한이 새로 나가는 일이 없도록 여기서 막는다.
-- ----------------------------------------------------------------------------
create or replace function public.live_object_owner(p_kind text, p_id uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select case p_kind
    when 'document' then (select owner_id from public.documents  where id = p_id and deleted_at is null)
    when 'code'     then (select owner_id from public.code_files where id = p_id and deleted_at is null)
    when 'sheet'    then (select owner_id from public.sheets     where id = p_id and deleted_at is null)
    when 'mindmap'  then (select owner_id from public.mind_maps  where id = p_id and deleted_at is null)
    when 'file'     then (select owner_id from public.files      where id = p_id and deleted_at is null)
  end;
$$;

revoke all on function public.live_object_owner(text, uuid) from public, anon;
grant execute on function public.live_object_owner(text, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 1) 한 사람에게 권한 부여 — 소유자/관리자만.
--    반환: 실제로 새로 주거나 올려 준 경우에만 true.
-- ----------------------------------------------------------------------------
create or replace function public.grant_object_access(
  p_kind text,
  p_id uuid,
  p_user uuid,
  p_permission text default 'view'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_existing text;
begin
  if p_permission not in ('view', 'edit') then
    raise exception 'permission must be view or edit';
  end if;
  if p_user is null or p_id is null then
    return false;
  end if;

  v_owner := public.live_object_owner(p_kind, p_id);

  if v_owner is null then
    return false;                       -- 없는 오브젝트이거나 지원하지 않는 종류
  end if;
  -- 줄 수 있는 사람인가. 소유자와 관리자만.
  if v_owner is distinct from auth.uid() and not public.is_admin() then
    return false;
  end if;
  -- 소유자 자신에게는 줄 것이 없다.
  if p_user = v_owner then
    return false;
  end if;

  if p_kind = 'document' then
    select permission into v_existing from public.document_permissions
      where document_id = p_id and user_id = p_user;
    if v_existing = 'edit' or v_existing = p_permission then return false; end if;
    insert into public.document_permissions (document_id, user_id, permission, granted_by)
      values (p_id, p_user, p_permission, auth.uid())
      on conflict (document_id, user_id) do update set permission = excluded.permission;
  elsif p_kind = 'code' then
    select permission into v_existing from public.code_file_permissions
      where code_file_id = p_id and user_id = p_user;
    if v_existing = 'edit' or v_existing = p_permission then return false; end if;
    insert into public.code_file_permissions (code_file_id, user_id, permission, granted_by)
      values (p_id, p_user, p_permission, auth.uid())
      on conflict (code_file_id, user_id) do update set permission = excluded.permission;
  elsif p_kind = 'sheet' then
    select permission into v_existing from public.sheet_permissions
      where sheet_id = p_id and user_id = p_user;
    if v_existing = 'edit' or v_existing = p_permission then return false; end if;
    insert into public.sheet_permissions (sheet_id, user_id, permission, granted_by)
      values (p_id, p_user, p_permission, auth.uid())
      on conflict (sheet_id, user_id) do update set permission = excluded.permission;
  elsif p_kind = 'mindmap' then
    select permission into v_existing from public.mind_map_permissions
      where mind_map_id = p_id and user_id = p_user;
    if v_existing = 'edit' or v_existing = p_permission then return false; end if;
    insert into public.mind_map_permissions (mind_map_id, user_id, permission, granted_by)
      values (p_id, p_user, p_permission, auth.uid())
      on conflict (mind_map_id, user_id) do update set permission = excluded.permission;
  elsif p_kind = 'file' then
    select permission into v_existing from public.file_permissions
      where file_id = p_id and user_id = p_user;
    if v_existing = 'edit' or v_existing = p_permission then return false; end if;
    insert into public.file_permissions (file_id, user_id, permission, granted_by)
      values (p_id, p_user, p_permission, auth.uid())
      on conflict (file_id, user_id) do update set permission = excluded.permission;
  else
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.grant_object_access(text, uuid, uuid, text) from public, anon;
grant execute on function public.grant_object_access(text, uuid, uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2) 대화의 모든 멤버에게 한 번에 — 첨부와 같은 순간에 호출된다.
--    반환 jsonb: { can_grant, granted, members, already }
--      can_grant  이 사람이 권한을 줄 수 있는가(소유자/관리자)
--      granted    이번에 새로 권한을 받은 사람 수
--      members    나를 제외한 대화 멤버 수
--      already    이미 볼 수 있던 사람 수(소유자·공개·기존 공유)
-- ----------------------------------------------------------------------------
create or replace function public.share_object_with_conversation(
  p_kind text,
  p_id uuid,
  p_conversation uuid,
  p_permission text default 'view'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_member uuid;
  v_granted int := 0;
  v_members int := 0;
  v_already int := 0;
  v_can_grant boolean;
begin
  if p_permission not in ('view', 'edit') then
    raise exception 'permission must be view or edit';
  end if;
  -- 이 대화의 멤버가 아니면 아무것도 하지 않는다.
  if not public.is_chat_member(p_conversation) then
    raise exception 'not a member of this conversation';
  end if;
  -- 볼 수 없는 것은 공유할 수도 없다.
  if not public.can_view_object(p_kind, p_id) then
    raise exception 'object not visible';
  end if;

  v_owner := public.live_object_owner(p_kind, p_id);
  if v_owner is null then
    raise exception 'object not available';
  end if;

  v_can_grant := (v_owner = auth.uid()) or public.is_admin();

  for v_member in
    select user_id from public.chat_members
    where conversation_id = p_conversation and user_id <> auth.uid()
  loop
    v_members := v_members + 1;
    if v_can_grant then
      if public.grant_object_access(p_kind, p_id, v_member, p_permission) then
        v_granted := v_granted + 1;
      else
        v_already := v_already + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'can_grant', v_can_grant,
    'granted', v_granted,
    'members', v_members,
    'already', v_already
  );
end;
$$;

revoke all on function public.share_object_with_conversation(text, uuid, uuid, text) from public, anon;
grant execute on function public.share_object_with_conversation(text, uuid, uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3) 첨부 카드용 메타데이터 일괄 조회.
--    p_refs 는 [{"kind":"document","id":"..."} , ...] 형태의 jsonb 배열.
--    볼 수 없는 항목도 행을 돌려준다 — 카드가 "권한 없음" 을 그려야 하기
--    때문이다. 단 그때는 제목/크기 같은 내용은 비우고, 누구에게 요청해야 하는지
--    (소유자 이름)만 알려 준다.
-- ----------------------------------------------------------------------------
create or replace function public.get_object_cards(p_refs jsonb)
returns table (
  kind text,
  id uuid,
  title text,
  subtitle text,
  owner_id uuid,
  owner_name text,
  updated_at timestamptz,
  size_bytes bigint,
  mime_type text,
  can_view boolean,
  can_edit boolean,
  object_exists boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ref jsonb;
  v_kind text;
  v_id uuid;
  v_seen text[] := '{}';
  v_key text;
  v_deleted timestamptz;
begin
  if p_refs is null or jsonb_typeof(p_refs) <> 'array' then
    return;
  end if;

  for v_ref in select * from jsonb_array_elements(p_refs) loop
    v_kind := v_ref->>'kind';
    begin
      v_id := (v_ref->>'id')::uuid;
    exception when others then
      continue;                                  -- 잘못된 uuid 는 조용히 건너뛴다
    end;
    if v_kind is null or v_id is null then continue; end if;

    v_key := v_kind || ':' || v_id::text;
    if v_key = any(v_seen) then continue; end if;  -- 같은 첨부가 여러 번 나와도 한 번만
    v_seen := v_seen || v_key;

    -- 최대 개수 제한 — 한 화면의 칩 수를 훨씬 넘는 요청은 받지 않는다.
    if array_length(v_seen, 1) > 200 then return; end if;

    kind := v_kind;
    id := v_id;
    title := null; subtitle := null;
    owner_id := null; owner_name := null;
    updated_at := null; size_bytes := null; mime_type := null;
    can_view := public.can_view_object(v_kind, v_id);
    can_edit := case when can_view then public.can_edit_object(v_kind, v_id) else false end;
    object_exists := true;

    v_deleted := null;
    if v_kind = 'document' then
      select d.title, d.updated_at, d.owner_id, d.deleted_at
        into title, updated_at, owner_id, v_deleted
        from public.documents d where d.id = v_id;
    elsif v_kind = 'code' then
      select c.name, c.updated_at, c.owner_id, c.language, c.deleted_at
        into title, updated_at, owner_id, subtitle, v_deleted
        from public.code_files c where c.id = v_id;
    elsif v_kind = 'sheet' then
      select s.title, s.updated_at, s.owner_id, s.deleted_at
        into title, updated_at, owner_id, v_deleted
        from public.sheets s where s.id = v_id;
    elsif v_kind = 'mindmap' then
      select m.title, m.updated_at, m.owner_id, m.deleted_at
        into title, updated_at, owner_id, v_deleted
        from public.mind_maps m where m.id = v_id;
    elsif v_kind = 'file' then
      select f.file_name, f.created_at, f.owner_id, f.size_bytes, f.mime_type, f.deleted_at
        into title, updated_at, owner_id, size_bytes, mime_type, v_deleted
        from public.files f where f.id = v_id;
    else
      continue;                                   -- 모르는 종류
    end if;

    -- 휴지통에 있는 항목은 "없는 것"으로 본다. can_view_object 는 RLS 를
    -- 우회하는 SECURITY DEFINER 라 deleted_at 을 보지 않으므로 여기서 거른다.
    if owner_id is null or v_deleted is not null then
      object_exists := false;
      can_view := false; can_edit := false;
      title := null; subtitle := null; size_bytes := null; mime_type := null; updated_at := null;
    else
      select coalesce(p.display_name, p.email) into owner_name
        from public.profiles p where p.id = owner_id;
      if not can_view then
        -- 내용은 감춘다. 소유자가 누구인지만 남겨 "요청하기" 를 그릴 수 있게.
        title := null; subtitle := null; size_bytes := null; mime_type := null; updated_at := null;
      end if;
    end if;

    return next;
  end loop;
end;
$$;

revoke all on function public.get_object_cards(jsonb) from public, anon;
grant execute on function public.get_object_cards(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) 권한 요청 — 누구에게 부탁해야 하는지 알려 준다.
--    제목은 돌려주지 않는다(볼 권한이 없는 사람에게 내용을 흘리지 않는다).
--    앱은 이 소유자와의 DM 을 열고 첨부 칩이 들어간 요청 메시지를 보낸다.
-- ----------------------------------------------------------------------------
create or replace function public.request_object_access(p_kind text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_owner uuid;
  v_name text;
begin
  v_owner := public.live_object_owner(p_kind, p_id);

  if v_owner is null then
    return jsonb_build_object('found', false);
  end if;
  if v_owner = auth.uid() then
    -- 이미 내 것이다. 요청할 대상이 없다.
    return jsonb_build_object('found', false);
  end if;

  select coalesce(display_name, email) into v_name from public.profiles where id = v_owner;
  return jsonb_build_object('found', true, 'owner_id', v_owner, 'owner_name', v_name);
end;
$$;

revoke all on function public.request_object_access(text, uuid) from public, anon;
grant execute on function public.request_object_access(text, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) 첨부 후보 목록 — 지금까지 앱이 4개 테이블을 각각 25개씩 긁어 왔다.
--    파일까지 포함해야 하고 검색도 돼야 하므로 한 번에 뽑는 RPC 로 옮긴다.
--    RLS 를 우회하지 않기 위해 각 테이블의 가시성 조건을 직접 반영한다.
-- ----------------------------------------------------------------------------
create or replace function public.list_attachable_objects(
  p_query text default null,
  p_limit int default 40
)
returns table (kind text, id uuid, title text, subtitle text, updated_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  with q as (select nullif(btrim(coalesce(p_query, '')), '') as term),
  candidates as (
    select 'document'::text as kind, d.id, d.title as title, null::text as subtitle, d.updated_at
      from public.documents d
     where d.deleted_at is null and public.can_view_object('document', d.id)
    union all
    select 'sheet', s.id, s.title, null, s.updated_at
      from public.sheets s
     where s.deleted_at is null and public.can_view_object('sheet', s.id)
    union all
    select 'code', c.id, c.name, c.language, c.updated_at
      from public.code_files c
     where c.deleted_at is null and public.can_view_object('code', c.id)
    union all
    select 'mindmap', m.id, m.title, null, m.updated_at
      from public.mind_maps m
     where m.deleted_at is null and public.can_view_object('mindmap', m.id)
    union all
    select 'file', f.id, f.file_name, f.mime_type, f.created_at
      from public.files f
     where f.deleted_at is null and public.can_view_object('file', f.id)
  )
  select c.kind, c.id, coalesce(nullif(c.title, ''), 'Untitled') as title, c.subtitle, c.updated_at
    from candidates c, q
   where q.term is null or c.title ilike '%' || q.term || '%'
   order by c.updated_at desc nulls last
   limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

revoke all on function public.list_attachable_objects(text, int) from public, anon;
grant execute on function public.list_attachable_objects(text, int) to authenticated;
