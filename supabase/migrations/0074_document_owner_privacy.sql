-- ============================================================================
-- 문서 프라이버시 레벨에 "Owner 전용" 추가 — 관리자도 못 본다.
-- ----------------------------------------------------------------------------
-- 지금까지 documents 는 is_public 하나뿐이었다. false("비공개")라도 실제로는
-- owner_id 본인 / document_permissions 로 명시 공유받은 사람 / 그리고 예외
-- 없이 public.is_admin() 이 전부 볼 수 있었다(documents_select, 0050). Admin
-- Code 를 redeem_admin_code 로 입력해 profiles.role='admin' 이 되는 순간부터
-- "비공개"라 표시된 문서 전부가 그 사람에게 열린다 — 관리자 계정 하나가
-- 뚫리면 조직의 모든 개인 문서가 함께 뚫리는 구조다. 개인적인 문서(일기·
-- 인사 기록 등)를 둘 자리가 없었다.
--
-- visibility 세 단계로 나눈다. is_public 은 지운다 — 두 컬럼이 서로 다른
-- 답을 낼 수 있는 상태(is_public=true 인데 visibility='owner' 같은)를
-- 만들지 않기 위해서다.
--   'owner'   — 소유자 본인만. document_permissions 공유도, is_admin() 도
--               통하지 않는다. 이번에 새로 추가하는 단계.
--   'private' — 지금까지의 "비공개" 그대로: 소유자 + 명시 공유 + 관리자.
--   'public'  — 지금까지의 is_public = true 그대로: 로그인한 모두가 보고 고침.
--
-- 이 컬럼을 참조하는 곳은 RLS 정책만이 아니다 — SECURITY DEFINER 함수 몇 개가
-- 성능/재사용을 위해 같은 조건을 각자 인라인해 두었다(can_view_object,
-- can_edit_object, search_ontology, list_conversation_plugins,
-- grant_object_access). 그 함수들은 RLS 를 우회하므로, 여기서 documents 의
-- 정책만 고치고 저 함수들을 그대로 두면 "목록/에디터에서는 안 보이는데 검색
-- 결과나 AI 대화 첨부, 실시간 채널 구독으로는 여전히 새는" 불일치가 남는다.
-- 이 마이그레이션은 그 다섯 함수도 전부 함께 고친다 — 그래야 "관리자는 절대
-- 못 본다"가 실제로 전부 참이 된다.
-- ============================================================================

alter table public.documents
  add column visibility text not null default 'private'
    check (visibility in ('owner', 'private', 'public'));

update public.documents
  set visibility = case when is_public then 'public' else 'private' end;

-- is_public 을 드는 순간 그 컬럼을 참조하는 기존 정책이 먼저 없어져야 한다
-- (Postgres 는 컬럼이 정책 안에서 살아 있으면 drop column 을 거부한다) —
-- 그래서 아래 세 정책의 drop 을 여기로 옮기고, 컬럼을 지운 다음에 새 정의로
-- 다시 만든다.
drop policy if exists documents_select on public.documents;
drop policy if exists documents_update on public.documents;
drop policy if exists documents_delete on public.documents;

alter table public.documents drop column is_public;

-- ---------------------------------------------------------------- documents
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select
using (
  deleted_at is null and (
    owner_id = (select auth.uid())
    or (
      visibility <> 'owner' and (
        visibility = 'public'
        or exists (
          select 1 from public.document_permissions dp
          where dp.document_id = documents.id and dp.user_id = (select auth.uid())
        )
        or public.is_admin()
      )
    )
  )
);

drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents for update
using (
  owner_id = (select auth.uid())
  or (
    visibility <> 'owner' and (
      visibility = 'public'
      or exists (
        select 1 from public.document_permissions dp
        where dp.document_id = documents.id
          and dp.user_id = (select auth.uid())
          and dp.permission = 'edit'
      )
      or public.is_admin()
    )
  )
);

-- documents_delete 는 관리자가 blind update(0049/0036 는 update 만 열었지만,
-- 방어적으로 delete 도 같은 원칙을 적용한다)로 visibility 를 먼저 내리고
-- 다음 요청에서 읽어버리는 우회를 막기 위해, 관리자 예외 자체를 'owner' 문서
-- 에서는 뺀다 — update 를 막아도 delete 가 열려 있으면 최소한 "지워서 없앨
-- 수는 있다"는 다른 형태의 통제력이 남으므로 함께 좁힌다.
drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents for delete
using (
  owner_id = (select auth.uid())
  or (visibility <> 'owner' and public.is_admin())
);

-- ---------------------------------------------------------- document_permissions
-- is_document_owner() 는 owner_id 매칭만 본다 — 소유자 본인은 자기 문서면
-- visibility 와 무관하게 언제나 공유를 관리할 수 있어야 하므로 그대로 둔다
-- (owner 단계인 문서에 공유를 추가해도 documents_select 가 막으므로 해가
-- 없다 — 다만 앱 레이어에서 헷갈리지 않게 미리 막는다, actions.ts 참고).
-- is_admin() 쪽만 'owner' 문서는 건드리지 못하게 좁힌다.
--
-- 주의: 이 조건을 raw exists(select … from public.documents …) 로 인라인하면
-- 안 된다. document_permissions 의 정책이 documents 를 authenticated 롤로 다시
-- 쿼리하면 documents_select 정책이 다시 평가되고, 그 정책은 document_permissions
-- 를 다시 쿼리하므로 documents_select ↔ document_permissions_select 가 서로를
-- 무한히 부른다("infinite recursion detected in policy") — 정확히 0017/0018 이
-- 이미 한 번 고쳤던 것과 같은 함정이다. is_document_owner() 와 같은 원칙으로,
-- SECURITY DEFINER 함수를 통해 documents 를 조회해야(그 함수 소유자 권한으로
-- 실행되어 RLS 를 다시 타지 않는다) 순환을 피한다.
create or replace function public.is_owner_only_document(p_document_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select visibility = 'owner' from public.documents where id = p_document_id),
    false
  );
$$;

revoke all on function public.is_owner_only_document(uuid) from public, anon;
grant execute on function public.is_owner_only_document(uuid) to authenticated;

drop policy if exists document_permissions_select on public.document_permissions;
create policy document_permissions_select on public.document_permissions for select
using (
  user_id = (select auth.uid())
  or public.is_document_owner(document_id)
  or (public.is_admin() and not public.is_owner_only_document(document_id))
);

drop policy if exists document_permissions_insert on public.document_permissions;
create policy document_permissions_insert on public.document_permissions for insert
with check (
  public.is_document_owner(document_id)
  or (public.is_admin() and not public.is_owner_only_document(document_id))
);

drop policy if exists document_permissions_delete on public.document_permissions;
create policy document_permissions_delete on public.document_permissions for delete
using (
  public.is_document_owner(document_id)
  or (public.is_admin() and not public.is_owner_only_document(document_id))
);

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER 함수들 — RLS 를 우회하므로 각자 documents 조건을 다시
-- 맞춘다. 로직은 위 documents_select/update 와 동일하게 유지한다.
-- ---------------------------------------------------------------------------

-- can_view_object() — 0015 최초 정의, 이후 재정의 없음(현재도 이 버전이 live).
-- get_linked_objects/list_attachable_objects/get_object_cards 가 이 함수로
-- 열람 가능 여부를 위임하므로, 여기 한 곳만 고치면 그래프 탐색·첨부 후보
-- 목록·첨부 카드가 전부 함께 맞아떨어진다.
create or replace function public.can_view_object(p_kind text, p_id uuid)
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
             or (
               d.visibility <> 'owner' and (
                 d.visibility = 'public'
                 or exists(select 1 from public.document_permissions dp where dp.document_id = d.id and dp.user_id = auth.uid())
                 or public.is_admin()
               )
             ))
    );
  elsif p_kind = 'code' then
    return exists(
      select 1 from public.code_files c
      where c.id = p_id
        and (c.owner_id = auth.uid() or c.is_public
             or exists(select 1 from public.code_file_permissions cp where cp.code_file_id = c.id and cp.user_id = auth.uid())
             or public.is_admin())
    );
  elsif p_kind = 'sheet' then
    return exists(
      select 1 from public.sheets s
      where s.id = p_id
        and (s.owner_id = auth.uid() or s.is_public
             or exists(select 1 from public.sheet_permissions sp where sp.sheet_id = s.id and sp.user_id = auth.uid())
             or public.is_admin())
    );
  elsif p_kind = 'mindmap' then
    return exists(
      select 1 from public.mind_maps m
      where m.id = p_id
        and (m.owner_id = auth.uid() or m.is_public
             or exists(select 1 from public.mind_map_permissions mp where mp.mind_map_id = m.id and mp.user_id = auth.uid())
             or public.is_admin())
    );
  elsif p_kind = 'file' then
    return exists(
      select 1 from public.files f
      where f.id = p_id
        and (f.owner_id = auth.uid() or f.is_public
             or exists(select 1 from public.file_permissions fp where fp.file_id = f.id and fp.user_id = auth.uid())
             or public.is_admin())
    );
  else
    return false;
  end if;
end;
$$;

revoke all on function public.can_view_object(text, uuid) from public, anon;
grant execute on function public.can_view_object(text, uuid) to authenticated;

-- can_edit_object() — 0036 이 마지막 정의(현재 live 버전). realtime 동시편집
-- 브로드캐스트 발신 인가(realtime_topic_editable, 0029)와 sync_object_links/
-- sync_object_tags(0034) 가 이 함수를 재사용한다 — 여기 한 곳만 고치면
-- "관리자가 못 보는 owner 문서의 실시간 채널에 가짜 편집을 주입하거나 태그/
-- 링크 그래프를 마음대로 바꾸는" 우회도 함께 막힌다.
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
             or (
               d.visibility <> 'owner' and (
                 d.visibility = 'public'
                 or exists(select 1 from public.document_permissions dp where dp.document_id = d.id and dp.user_id = auth.uid() and dp.permission = 'edit')
                 or public.is_admin()
               )
             ))
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

-- search_ontology() — 0072 최신 버전. can_view_object 를 행마다 부르는 대신
-- 같은 조건을 인라인해 인덱스와 함께 평가한다(꼬리 지연 최적화, 0072 참고) —
-- 그래서 위 can_view_object 를 고쳐도 검색은 자동으로 안 맞는다. 문서 브랜치만
-- 다시 맞춘다.
create or replace function public.search_ontology(p_query text)
returns table(kind text, id uuid, title text, snippet text, rank real, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_tsquery tsquery;
  v_uid uuid;
  v_admin boolean;
begin
  if p_query is null or length(trim(p_query)) = 0 then
    return;
  end if;

  v_tsquery := websearch_to_tsquery('simple', p_query);
  if v_tsquery is null then
    return;
  end if;

  v_uid := auth.uid();
  v_admin := public.is_admin();

  return query
  with hits as (
    (select 'document'::text as kind, d.id, d.title,
            ts_rank(d.search_vector, v_tsquery) as rank, d.updated_at
       from public.documents d
      where d.search_vector @@ v_tsquery
        and (
          d.owner_id = v_uid
          or (
            d.visibility <> 'owner' and (
              v_admin or d.visibility = 'public'
              or exists(select 1 from public.document_permissions dp
                         where dp.document_id = d.id and dp.user_id = v_uid)
            )
          )
        )
      order by ts_rank(d.search_vector, v_tsquery) desc
      limit 30)
    union all
    (select 'code'::text, c.id, c.name,
            ts_rank(c.search_vector, v_tsquery), c.updated_at
       from public.code_files c
      where c.search_vector @@ v_tsquery
        and (v_admin or c.owner_id = v_uid or c.is_public
             or exists(select 1 from public.code_file_permissions cp
                        where cp.code_file_id = c.id and cp.user_id = v_uid))
      order by ts_rank(c.search_vector, v_tsquery) desc
      limit 30)
    union all
    (select 'sheet'::text, s.id, s.title,
            ts_rank(s.search_vector, v_tsquery), s.updated_at
       from public.sheets s
      where s.search_vector @@ v_tsquery
        and (v_admin or s.owner_id = v_uid or s.is_public
             or exists(select 1 from public.sheet_permissions sp
                        where sp.sheet_id = s.id and sp.user_id = v_uid))
      order by ts_rank(s.search_vector, v_tsquery) desc
      limit 30)
    union all
    (select 'mindmap'::text, m.id, m.title,
            ts_rank(m.search_vector, v_tsquery), m.updated_at
       from public.mind_maps m
      where m.search_vector @@ v_tsquery
        and (v_admin or m.owner_id = v_uid or m.is_public
             or exists(select 1 from public.mind_map_permissions mp
                        where mp.mind_map_id = m.id and mp.user_id = v_uid))
      order by ts_rank(m.search_vector, v_tsquery) desc
      limit 30)
    union all
    (select 'file'::text, f.id, f.file_name,
            ts_rank(f.search_vector, v_tsquery), f.created_at
       from public.files f
      where f.search_vector @@ v_tsquery
        and (v_admin or f.owner_id = v_uid or f.is_public
             or exists(select 1 from public.file_permissions fp
                        where fp.file_id = f.id and fp.user_id = v_uid))
      order by ts_rank(f.search_vector, v_tsquery) desc
      limit 30)
  ),
  top as (
    select * from hits order by hits.rank desc limit 30
  )
  select t.kind, t.id, t.title,
         case t.kind
           when 'document' then (select left(public.jsonb_extract_text(d.content), 200)
                                   from public.documents d where d.id = t.id)
           when 'code'     then (select left(c.content, 200)
                                   from public.code_files c where c.id = t.id)
           when 'sheet'    then (select left(public.jsonb_all_strings(s.data), 200)
                                   from public.sheets s where s.id = t.id)
           when 'mindmap'  then (select left(public.jsonb_all_strings(m.data), 200)
                                   from public.mind_maps m where m.id = t.id)
           when 'file'     then (select coalesce(f.mime_type, '')
                                   from public.files f where f.id = t.id)
         end,
         t.rank, t.updated_at
    from top t
   order by t.rank desc;
end;
$function$;

revoke all on function public.search_ontology(text) from public, anon;
grant execute on function public.search_ontology(text) to authenticated;

-- list_conversation_plugins() — 0064 최신 버전(AI 대화에 첨부된 객체의
-- 제목/부제를 돌려준다). 문서 브랜치만 다시 맞춘다.
create or replace function public.list_conversation_plugins(p_conversation_id uuid)
returns table(kind text, object_id uuid, title text, subtitle text)
language sql
stable security definer
set search_path to 'public'
as $function$
  select p.kind, p.object_id, t.title, t.subtitle
  from public.ai_conversation_plugins p
  join public.ai_conversations c on c.id = p.conversation_id
  join lateral (
    select d.title, null::text as subtitle
    from public.documents d
    where p.kind = 'document' and d.id = p.object_id and d.deleted_at is null
      and (d.owner_id = auth.uid()
           or (
             d.visibility <> 'owner' and (
               d.visibility = 'public'
               or exists(select 1 from public.document_permissions dp where dp.document_id = d.id and dp.user_id = auth.uid())
               or public.is_admin()
             )
           ))
    union all
    select f.name, f.path
    from public.code_files f
    where p.kind = 'code' and f.id = p.object_id and f.deleted_at is null
      and (f.owner_id = auth.uid() or f.is_public
           or exists(select 1 from public.code_file_permissions cp where cp.code_file_id = f.id and cp.user_id = auth.uid())
           or public.is_admin())
    union all
    select s.title, null::text
    from public.sheets s
    where p.kind = 'sheet' and s.id = p.object_id and s.deleted_at is null
      and (s.owner_id = auth.uid() or s.is_public
           or exists(select 1 from public.sheet_permissions sp where sp.sheet_id = s.id and sp.user_id = auth.uid())
           or public.is_admin())
    union all
    select m.title, null::text
    from public.mind_maps m
    where p.kind = 'mindmap' and m.id = p.object_id and m.deleted_at is null
      and (m.owner_id = auth.uid() or m.is_public
           or exists(select 1 from public.mind_map_permissions mp where mp.mind_map_id = m.id and mp.user_id = auth.uid())
           or public.is_admin())
    union all
    select r.name, null::text
    from public.repositories r
    where p.kind = 'repository' and r.id = p.object_id
      and (r.owner_id = auth.uid() or public.is_admin())
    union all
    select cr.name, coalesce(cr.github_owner || '/' || cr.github_repo, null)
    from public.code_repositories cr
    where p.kind = 'code_space' and cr.id = p.object_id and cr.deleted_at is null
      and (cr.owner_id = auth.uid() or public.is_admin())
  ) t on true
  where p.conversation_id = p_conversation_id
    and c.owner_id = (select auth.uid())
  order by p.created_at;
$function$;

-- grant_object_access() — 0065. "볼 수 없는 것은 공유할 수도 없다"는
-- share_object_with_conversation() 은 can_view_object 를 먼저 호출하므로 위
-- 수정으로 이미 막힌다. 하지만 grant_object_access() 자신은 can_view_object 를
-- 부르지 않고 소유자/관리자 여부만 직접 검사했다 — 관리자가 자기 자신에게
-- (또는 제3자에게) owner 단계 문서의 열람 권한을 몰래 부여할 수 있는 유일한
-- 남은 구멍이었다. 대상이 문서이고 visibility='owner' 이면 관리자 예외를 뺀다.
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
  v_owner_only boolean := false;
begin
  if p_permission not in ('view', 'edit') then
    raise exception 'permission must be view or edit';
  end if;
  if p_user is null or p_id is null then
    return false;
  end if;

  v_owner := public.live_object_owner(p_kind, p_id);

  if v_owner is null then
    return false;
  end if;

  if p_kind = 'document' then
    select (visibility = 'owner') into v_owner_only from public.documents where id = p_id;
  end if;

  -- 줄 수 있는 사람인가. 소유자, 그리고 'owner' 단계가 아닌 한 관리자.
  if v_owner is distinct from auth.uid() and (v_owner_only or not public.is_admin()) then
    return false;
  end if;
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
