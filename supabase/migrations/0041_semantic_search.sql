-- ============================================================================
-- 시맨틱 검색(RAG 검색 레이어) + 온톨로지 다단계 링크 탐색
-- ----------------------------------------------------------------------------
-- 1) object_embeddings — 문서/코드/시트/마인드맵의 임베딩(NVIDIA NIM
--    nv-embedqa-e5-v5, 1024차원)을 pgvector 로 저장. 저장 파이프라인은
--    lib/embeddings.ts: 저장 시 내용 해시가 바뀐 경우에만 임베딩 API 를 다시
--    호출한다(자동저장 남발 방지). 검색은 기존 tsvector 검색(search_ontology)
--    과 결합된 하이브리드 — 어휘 일치 + 의미 유사도, 둘 다 RLS(can_view_object)
--    를 그대로 통과해야 보인다.
-- 2) get_linked_objects_deep — object_links 그래프를 재귀 CTE 로 p_depth 단계
--    까지 탐색(사이클 방지 포함). "이 문서와 2다리 건너 연결된 것"을 검색
--    콘솔에서 바로 펼칠 수 있게 한다.
-- ============================================================================

create extension if not exists vector with schema extensions;

create table public.object_embeddings (
  kind text not null check (kind in ('document', 'code', 'sheet', 'mindmap')),
  object_id uuid not null,
  -- 내용 sha256 — 같으면 임베딩 API 호출을 건너뛴다.
  content_hash text not null,
  embedding extensions.vector(1024) not null,
  updated_at timestamptz not null default now(),
  primary key (kind, object_id)
);

-- ponytail: 수천 행 규모까지는 순차 스캔도 충분하지만, HNSW 를 미리 걸어둬야
-- 데이터가 커져도 검색이 밀리초대를 유지한다(코사인 거리).
create index object_embeddings_hnsw_idx
  on public.object_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);

-- 폴리모픽 대상이라 직접 접근은 전면 차단 — 아래 함수로만 읽고 쓴다
-- (object_links 와 동일한 패턴).
alter table public.object_embeddings enable row level security;
create policy object_embeddings_no_direct_access
  on public.object_embeddings for all using (false);

-- ----------------------------------------------------------------------------
-- 쓰기 경로 — 편집 권한이 있는 사용자의 저장 액션에서만 호출된다.
-- ----------------------------------------------------------------------------

-- 임베딩 재계산이 필요한가? (행이 없거나 해시가 다르면 true)
create or replace function public.object_embedding_stale(
  p_kind text, p_id uuid, p_hash text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.can_edit_object(p_kind, p_id)
     and not exists(
       select 1 from public.object_embeddings
       where kind = p_kind and object_id = p_id and content_hash = p_hash
     );
$$;

-- 임베딩 upsert. 벡터는 pgvector 텍스트 표기('[0.1,0.2,...]')로 받는다 —
-- PostgREST 를 거치는 클라이언트 타입 문제를 피하기 위함.
create or replace function public.upsert_object_embedding(
  p_kind text, p_id uuid, p_hash text, p_embedding text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.can_edit_object(p_kind, p_id) then
    raise exception 'not_authorized';
  end if;
  insert into public.object_embeddings (kind, object_id, content_hash, embedding, updated_at)
  values (p_kind, p_id, p_hash, p_embedding::extensions.vector(1024), now())
  on conflict (kind, object_id) do update
    set content_hash = excluded.content_hash,
        embedding = excluded.embedding,
        updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.object_embedding_stale(text, uuid, text) from public, anon;
grant execute on function public.object_embedding_stale(text, uuid, text) to authenticated;
revoke all on function public.upsert_object_embedding(text, uuid, text, text) from public, anon;
grant execute on function public.upsert_object_embedding(text, uuid, text, text) to authenticated;

-- 오브젝트 삭제 시 임베딩도 함께 정리 — 기존 cleanup_object_links(모든 삭제
-- 경로가 이미 호출)에 한 줄 얹는다.
create or replace function public.cleanup_object_links(p_kind text, p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.object_links
  where (from_kind = p_kind and from_id = p_id)
     or (to_kind = p_kind and to_id = p_id);
  delete from public.object_embeddings
  where kind = p_kind and object_id = p_id;
$$;

-- ----------------------------------------------------------------------------
-- 읽기 경로 — 의미 유사도 검색(권한 필터 포함)
-- ----------------------------------------------------------------------------
create or replace function public.match_objects(
  p_embedding text,
  p_limit int default 8,
  p_kind text default null
)
returns table (kind text, id uuid, title text, similarity real)
language sql
security definer
set search_path = public, extensions
stable
as $$
  -- 후보를 넉넉히(limit*5) 뽑은 뒤 권한 필터를 적용한다 — HNSW 정렬을 먼저
  -- 태워야 인덱스가 쓰이고, 권한 필터로 일부가 떨어져도 상위 p_limit 는 남는다.
  with candidates as (
    select e.kind, e.object_id,
           (1 - (e.embedding <=> p_embedding::extensions.vector(1024)))::real as sim
    from public.object_embeddings e
    where p_kind is null or e.kind = p_kind
    order by e.embedding <=> p_embedding::extensions.vector(1024)
    limit least(greatest(coalesce(p_limit, 8), 1), 50) * 5
  )
  select c.kind, c.object_id,
         case c.kind
           when 'document' then (select d.title from public.documents d where d.id = c.object_id)
           when 'code' then (select cf.name from public.code_files cf where cf.id = c.object_id)
           when 'sheet' then (select s.title from public.sheets s where s.id = c.object_id)
           when 'mindmap' then (select m.title from public.mind_maps m where m.id = c.object_id)
         end,
         c.sim
  from candidates c
  where public.can_view_object(c.kind, c.object_id)
  order by c.sim desc
  limit least(greatest(coalesce(p_limit, 8), 1), 50);
$$;

revoke all on function public.match_objects(text, int, text) from public, anon;
grant execute on function public.match_objects(text, int, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 다단계 링크 탐색 — 재귀 CTE, 사이클 방지(path 배열), 깊이 1~3 제한.
-- 반환의 depth 는 최단 도달 깊이, via_title 은 depth>1 일 때 경유한 항목 제목.
-- ----------------------------------------------------------------------------
create or replace function public.get_linked_objects_deep(
  p_kind text, p_id uuid, p_depth int default 2
)
returns table (kind text, id uuid, title text, link_source text, depth int, via_title text)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_depth int := least(greatest(coalesce(p_depth, 2), 1), 3);
begin
  if not public.can_view_object(p_kind, p_id) then
    return;
  end if;

  return query
  -- ponytail: 전체 그래프 폭발은 depth<=3 캡으로만 막는다 — 링크 수가 수만
  -- 단위로 커지면 방문 노드 상한(LIMIT)을 추가할 것.
  with recursive walk(w_kind, w_id, w_source, w_depth, via_kind, via_id, path) as (
    select p_kind, p_id, ''::text, 0, null::text, null::uuid,
           array[p_kind || ':' || p_id::text]
    union all
    select n.n_kind, n.n_id, n.n_source, w.w_depth + 1, w.w_kind, w.w_id,
           w.path || (n.n_kind || ':' || n.n_id::text)
    from walk w
    cross join lateral (
      select l.to_kind as n_kind, l.to_id as n_id, l.source as n_source
        from public.object_links l
        where l.from_kind = w.w_kind and l.from_id = w.w_id
      union
      select l.from_kind, l.from_id, l.source
        from public.object_links l
        where l.to_kind = w.w_kind and l.to_id = w.w_id
    ) n
    where w.w_depth < v_depth
      and not ((n.n_kind || ':' || n.n_id::text) = any(w.path))
  ),
  shortest as (
    select distinct on (w.w_kind, w.w_id)
           w.w_kind, w.w_id, w.w_source, w.w_depth, w.via_kind, w.via_id
    from walk w
    where w.w_depth > 0
    order by w.w_kind, w.w_id, w.w_depth
  )
  select s.w_kind, s.w_id,
         case s.w_kind
           when 'document' then (select d.title from public.documents d where d.id = s.w_id)
           when 'code' then (select c.name from public.code_files c where c.id = s.w_id)
           when 'sheet' then (select sh.title from public.sheets sh where sh.id = s.w_id)
           when 'mindmap' then (select m.title from public.mind_maps m where m.id = s.w_id)
           when 'file' then (select f.file_name from public.files f where f.id = s.w_id)
         end,
         s.w_source,
         s.w_depth,
         case when s.w_depth > 1 then
           case s.via_kind
             when 'document' then (select d.title from public.documents d where d.id = s.via_id)
             when 'code' then (select c.name from public.code_files c where c.id = s.via_id)
             when 'sheet' then (select sh.title from public.sheets sh where sh.id = s.via_id)
             when 'mindmap' then (select m.title from public.mind_maps m where m.id = s.via_id)
             when 'file' then (select f.file_name from public.files f where f.id = s.via_id)
           end
         end
  from shortest s
  where public.can_view_object(s.w_kind, s.w_id)
    and case s.w_kind
          when 'document' then exists(select 1 from public.documents d where d.id = s.w_id)
          when 'code' then exists(select 1 from public.code_files c where c.id = s.w_id)
          when 'sheet' then exists(select 1 from public.sheets sh where sh.id = s.w_id)
          when 'mindmap' then exists(select 1 from public.mind_maps m where m.id = s.w_id)
          when 'file' then exists(select 1 from public.files f where f.id = s.w_id)
        end
  order by s.w_depth, s.w_kind;
end;
$$;

revoke all on function public.get_linked_objects_deep(text, uuid, int) from public, anon;
grant execute on function public.get_linked_objects_deep(text, uuid, int) to authenticated;
