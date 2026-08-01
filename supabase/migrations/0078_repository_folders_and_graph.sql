-- ============================================================================
-- Repository 폴더 계층 + 그래프형 데이터 모델(Obsidian 스타일).
-- ----------------------------------------------------------------------------
-- 지금까지 repositories(0044)는 평평했다 — 아이템은 저장소 하나에 바로
-- 속할 뿐, 저장소 "안에 또 저장소"를 만들 수 없었다. parent_id 하나를
-- 추가해 자기참조 트리로 바꾼다: 최상위 저장소는 parent_id 가 null, 그
-- 밑에 만드는 "폴더"는 그냥 parent_id 가 채워진 또 다른 repositories 행이다
-- — Obsidian 이 vault 와 폴더를 구분하지 않는 것과 같은 모양이다.
--
-- 이 위에 두 가지를 더 얹는다.
--   1) list_repository_contents 에 폴더(kind='folder')와 파일(kind='file')
--      을 더한다 — 지금까지 documents/code/sheets/mind_maps 만 보여주고
--      "파일은 /files 표가 따로 보여준다"고 미뤄 뒀던 것(0075)을 여기서
--      마저 합친다. 여전히 "바로 아래 자식"만 보여준다(드릴다운 목록용).
--   2) get_repository_graph(p_repository) — 저장소 서브트리 전체(재귀)를
--      노드(폴더/문서/코드/시트/맵/파일/캘린더 일정)와 간선(포함관계 +
--      object_links 참조 + calendar_event_links)으로 한 번에 묶어 돌려준다.
--      List 보기와 Graph 보기를 한 화면에서 토글하기 위한 자료다.
-- ============================================================================

-- ---------------------------------------------------------------- 폴더 계층
alter table public.repositories
  add column parent_id uuid references public.repositories(id) on delete set null;

create index repositories_parent_idx on public.repositories (parent_id);

-- 순환 방지 + 깊이 상한(8단) + 소유자 일치 — 셋 다 트리거 하나에서 검사한다.
-- 상위 저장소를 지우면(on delete set null 이미 위에서 걸었다) 그 밑의 폴더는
-- 통째로 사라지는 대신 최상위로 "승격"된다 — 아이템을 저장소째 지워도
-- Null Repository 로 돌려보낼 뿐 지우지 않는 기존 원칙과 같다.
create or replace function public.prevent_repository_cycle()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_cursor uuid;
  v_owner uuid;
  v_depth int := 0;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'a repository cannot be its own parent';
  end if;

  select owner_id into v_owner from public.repositories where id = new.parent_id;
  if v_owner is null then
    raise exception 'parent repository not found';
  end if;
  if v_owner <> new.owner_id then
    raise exception 'a repository can only nest inside a repository you own';
  end if;

  v_cursor := new.parent_id;
  while v_cursor is not null loop
    v_depth := v_depth + 1;
    if v_depth > 8 then
      raise exception 'repository nesting is limited to 8 levels';
    end if;
    if v_cursor = new.id then
      raise exception 'repository parent chain would create a cycle';
    end if;
    select parent_id into v_cursor from public.repositories where id = v_cursor;
  end loop;

  return new;
end;
$$;

drop trigger if exists repositories_prevent_cycle on public.repositories;
create trigger repositories_prevent_cycle
before insert or update of parent_id on public.repositories
for each row execute function public.prevent_repository_cycle();

-- ---------------------------------------------------- list_repository_contents
-- 폴더(같은 repositories 테이블에서 parent_id = p_repository 인 행)와 파일을
-- 더한다. p_repository 가 null 이면(Null Repository) 폴더는 없다 — 최상위
-- 저장소 자체가 parent_id is null 인 행이라 이미 랜딩 목록(listRepositories)
-- 에서 보여주고 있고, 여기서 또 보여주면 중복이다.
create or replace function public.list_repository_contents(p_repository uuid default null)
returns table (kind text, id uuid, label text)
language sql
stable
set search_path = public
as $$
  (select 'folder'::text as kind, r.id, r.name as label
     from public.repositories r
    where p_repository is not null and r.parent_id = p_repository
    order by r.name
    limit 200)
  union all
  (select 'document'::text as kind, d.id, coalesce(nullif(d.title, ''), 'Untitled') as label
    from public.documents d
   where d.deleted_at is null
     and ((p_repository is null and d.repository_id is null) or d.repository_id = p_repository)
   order by d.updated_at desc
   limit 100)
  union all
  (select 'code'::text, c.id, c.name
    from public.code_files c
   where c.deleted_at is null
     and ((p_repository is null and c.repository_id is null) or c.repository_id = p_repository)
   order by c.updated_at desc
   limit 100)
  union all
  (select 'sheet'::text, s.id, coalesce(nullif(s.title, ''), 'Untitled')
    from public.sheets s
   where s.deleted_at is null
     and ((p_repository is null and s.repository_id is null) or s.repository_id = p_repository)
   order by s.updated_at desc
   limit 100)
  union all
  (select 'mindmap'::text, m.id, coalesce(nullif(m.title, ''), 'Untitled')
    from public.mind_maps m
   where m.deleted_at is null
     and ((p_repository is null and m.repository_id is null) or m.repository_id = p_repository)
   order by m.updated_at desc
   limit 100)
  union all
  (select 'file'::text, f.id, f.file_name
    from public.files f
   where f.deleted_at is null
     and ((p_repository is null and f.repository_id is null) or f.repository_id = p_repository)
   order by f.created_at desc
   limit 100);
$$;

revoke all on function public.list_repository_contents(uuid) from public, anon;
grant execute on function public.list_repository_contents(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_repository_graph — 저장소 하나를 그래프로.
-- ----------------------------------------------------------------------------
-- 저장소는 공유 개념이 없으므로(0044) 소유자 본인 또는 관리자만 호출할 수
-- 있다. 그 안에서도 각 아이템/일정은 can_view_object/can_view_event 로 한 번
-- 더 확인한다 — 저장소 소유자가 아닌 다른 사람이 (문서 편집 권한만으로)
-- 자기 문서를 남의 저장소에 잘못 걸어 둔 경우에도, 저장소 소유자에게 실제로
-- 보이지 않는 문서까지 그래프에 새지 않게 한다.
--
-- 노드: 폴더 · 문서 · 코드 · 시트 · 마인드맵 · 파일 · 캘린더 일정.
-- 간선: (a) 포함관계 — 각 노드의 "바로 담긴 폴더"(container_id, 저장소
--       자기 자신이면 null — 저장소 자체는 노드가 아니라 그래프의 뿌리다).
--       (b) 참조 — object_links 중 양끝이 전부 이 그래프 안에 있는 것만.
--       (c) 일정 연결 — calendar_event_links 중 양끝이 전부 이 그래프 안에
--       있는 것만.
create or replace function public.get_repository_graph(p_repository uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_owner uuid;
  v_result jsonb;
begin
  select owner_id into v_owner from public.repositories where id = p_repository;
  if v_owner is null or (v_owner <> auth.uid() and not public.is_admin()) then
    return jsonb_build_object('nodes', jsonb_build_array(), 'edges', jsonb_build_array());
  end if;

  with recursive subtree(id, name, parent_id, depth) as (
    select r.id, r.name, r.parent_id, 0
      from public.repositories r where r.id = p_repository
    union all
    select r.id, r.name, r.parent_id, s.depth + 1
      from public.repositories r
      join subtree s on r.parent_id = s.id
     where s.depth < 12
  ),
  folder_nodes as (
    select id as node_id, 'folder'::text as kind, name as label,
           case when parent_id = p_repository then null else parent_id end as container_id
      from subtree
     where id <> p_repository
  ),
  -- UNION ALL 은 첫 번째 가지의 컬럼 이름만 쓴다 — 나머지 가지에서 별칭을
  -- 달아도 무시된다. all_nodes 가 item_nodes.kind/label/container_id 를
  -- 이름으로 참조해야 하므로, CTE 자체에 컬럼 이름을 명시해 모든 가지가
  -- 같은 이름으로 통일되게 한다.
  item_nodes (id, kind, label, container_id) as (
    select d.id, 'document'::text, coalesce(nullif(d.title, ''), 'Untitled'),
           case when d.repository_id = p_repository then null else d.repository_id end
      from public.documents d
     where d.deleted_at is null and d.repository_id in (select id from subtree)
       and public.can_view_object('document', d.id)
    union all
    select c.id, 'code'::text, c.name,
           case when c.repository_id = p_repository then null else c.repository_id end
      from public.code_files c
     where c.deleted_at is null and c.repository_id in (select id from subtree)
       and public.can_view_object('code', c.id)
    union all
    select s.id, 'sheet'::text, coalesce(nullif(s.title, ''), 'Untitled'),
           case when s.repository_id = p_repository then null else s.repository_id end
      from public.sheets s
     where s.deleted_at is null and s.repository_id in (select id from subtree)
       and public.can_view_object('sheet', s.id)
    union all
    select m.id, 'mindmap'::text, coalesce(nullif(m.title, ''), 'Untitled'),
           case when m.repository_id = p_repository then null else m.repository_id end
      from public.mind_maps m
     where m.deleted_at is null and m.repository_id in (select id from subtree)
       and public.can_view_object('mindmap', m.id)
    union all
    select f.id, 'file'::text, f.file_name,
           case when f.repository_id = p_repository then null else f.repository_id end
      from public.files f
     where f.deleted_at is null and f.repository_id in (select id from subtree)
       and public.can_view_object('file', f.id)
  ),
  event_nodes (id, kind, label, container_id) as (
    select e.id, 'event'::text, e.title,
           case when e.repository_id = p_repository then null else e.repository_id end
      from public.calendar_events e
     where e.repository_id in (select id from subtree)
       and public.can_view_event(e.id)
  ),
  all_nodes as (
    select node_id, kind, label, container_id from folder_nodes
    union all
    select id, kind, label, container_id from item_nodes
    union all
    select id, kind, label, container_id from event_nodes
  ),
  ref_edges as (
    select ol.from_kind as a_kind, ol.from_id as a_id, ol.to_kind as b_kind, ol.to_id as b_id
      from public.object_links ol
     where exists(select 1 from all_nodes n where n.kind = ol.from_kind and n.node_id = ol.from_id)
       and exists(select 1 from all_nodes n where n.kind = ol.to_kind and n.node_id = ol.to_id)
  ),
  event_edges as (
    select 'event'::text as a_kind, l.event_id as a_id, l.object_kind as b_kind, l.object_id as b_id
      from public.calendar_event_links l
     where exists(select 1 from all_nodes n where n.kind = 'event' and n.node_id = l.event_id)
       and exists(select 1 from all_nodes n where n.kind = l.object_kind and n.node_id = l.object_id)
  )
  select jsonb_build_object(
    'nodes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', kind, 'id', node_id, 'label', label, 'containerId', container_id
      ))
      from all_nodes
    ), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(jsonb_build_object('aKind', a_kind, 'aId', a_id, 'bKind', b_kind, 'bId', b_id))
      from (select * from ref_edges union all select * from event_edges) e
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_repository_graph(uuid) from public, anon;
grant execute on function public.get_repository_graph(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_object_events — 문서(등)를 참조하는 캘린더 일정 역방향 조회.
-- ----------------------------------------------------------------------------
-- calendar_event_links(0066)는 지금까지 일정 → 자료 방향으로만 조회됐다
-- (get_calendar_event 가 그 일정에 뭐가 걸려 있는지 보여주는 용도). 반대
-- 방향(자료를 열었을 때 "이 자료를 참조하는 일정이 있나")은 없었다 —
-- 문서 에디터에 "관련 일정"을 보여주려면 이 방향이 필요하다.
create or replace function public.get_object_events(p_kind text, p_id uuid)
returns table (
  id uuid,
  title text,
  starts_at timestamptz,
  all_day boolean,
  calendar_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.title, e.starts_at, e.all_day, e.calendar_id
    from public.calendar_event_links l
    join public.calendar_events e on e.id = l.event_id
   where l.object_kind = p_kind and l.object_id = p_id
     and public.can_view_event(e.id)
   order by e.starts_at desc
   limit 20;
$$;

revoke all on function public.get_object_events(text, uuid) from public, anon;
grant execute on function public.get_object_events(text, uuid) to authenticated;
