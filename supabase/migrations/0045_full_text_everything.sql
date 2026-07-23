-- ============================================================================
-- 전문검색을 "제목뿐 아니라 내용 전체"로 확장.
-- ----------------------------------------------------------------------------
-- 문서·코드는 이미 본문을 색인(0015)하지만 시트·마인드맵은 제목만 색인했다.
-- 시트 셀 값(celldata)·마인드맵 노드 토픽/노트까지 검색되도록, JSON 의 모든
-- 문자열 리프를 재귀적으로 모으는 immutable 함수 jsonb_all_strings 를 만들고
-- 두 테이블의 생성 컬럼(search_vector)을 재정의한다. search_ontology 는
-- 시트·마인드맵 결과에도 스니펫을 채우도록 갱신한다.
-- ============================================================================

create or replace function public.jsonb_all_strings(node jsonb)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  result text := '';
  child jsonb;
  key text;
begin
  if node is null then
    return '';
  end if;
  case jsonb_typeof(node)
    when 'string' then
      result := (node #>> '{}') || ' ';
    when 'array' then
      for child in select * from jsonb_array_elements(node) loop
        result := result || public.jsonb_all_strings(child);
      end loop;
    when 'object' then
      for key in select * from jsonb_object_keys(node) loop
        result := result || public.jsonb_all_strings(node -> key);
      end loop;
    else
      -- number/boolean/null 은 검색 대상에서 제외
      null;
  end case;
  return result;
end;
$$;

-- 시트: 제목(A) + 모든 셀/시트명 텍스트(B). 생성 컬럼 재정의(drop→add, 인덱스도 재생성).
drop index if exists sheets_search_idx;
alter table public.sheets drop column if exists search_vector;
alter table public.sheets
  add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', public.jsonb_all_strings(data)), 'B')
  ) stored;
create index sheets_search_idx on public.sheets using gin (search_vector);

-- 마인드맵: 제목(A) + 모든 노드 토픽/노트 텍스트(B).
drop index if exists mind_maps_search_idx;
alter table public.mind_maps drop column if exists search_vector;
alter table public.mind_maps
  add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', public.jsonb_all_strings(data)), 'B')
  ) stored;
create index mind_maps_search_idx on public.mind_maps using gin (search_vector);

-- 시트·마인드맵 결과에도 스니펫(내용 앞부분)을 채운다.
create or replace function public.search_ontology(p_query text)
returns table(kind text, id uuid, title text, snippet text, rank real, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_tsquery tsquery;
begin
  if p_query is null or length(trim(p_query)) = 0 then
    return;
  end if;

  v_tsquery := websearch_to_tsquery('simple', p_query);
  if v_tsquery is null then
    return;
  end if;

  return query
    select r.kind, r.id, r.title, r.snippet, r.rank, r.updated_at
    from (
      select 'document'::text as kind, d.id, d.title,
             left(public.jsonb_extract_text(d.content), 200) as snippet,
             ts_rank(d.search_vector, v_tsquery) as rank,
             d.updated_at
        from public.documents d
        where d.search_vector @@ v_tsquery
      union all
      select 'code'::text, c.id, c.name,
             left(c.content, 200),
             ts_rank(c.search_vector, v_tsquery),
             c.updated_at
        from public.code_files c
        where c.search_vector @@ v_tsquery
      union all
      select 'sheet'::text, s.id, s.title,
             left(public.jsonb_all_strings(s.data), 200),
             ts_rank(s.search_vector, v_tsquery),
             s.updated_at
        from public.sheets s
        where s.search_vector @@ v_tsquery
      union all
      select 'mindmap'::text, m.id, m.title,
             left(public.jsonb_all_strings(m.data), 200),
             ts_rank(m.search_vector, v_tsquery),
             m.updated_at
        from public.mind_maps m
        where m.search_vector @@ v_tsquery
      union all
      select 'file'::text, f.id, f.file_name, coalesce(f.mime_type, ''),
             ts_rank(f.search_vector, v_tsquery),
             f.created_at
        from public.files f
        where f.search_vector @@ v_tsquery
    ) r
    where public.can_view_object(r.kind, r.id)
    order by r.rank desc
    limit 30;
end;
$$;

revoke all on function public.search_ontology(text) from public, anon;
grant execute on function public.search_ontology(text) to authenticated;
