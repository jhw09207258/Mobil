-- ============================================================================
-- 통합 검색의 꼬리 지연 제거.
--
-- 측정(문서 3,000 · 파일 4,000, authenticated 롤):
--   드문 낱말        1.1 ms
--   없는 낱말        0.7 ms
--   흔한 낱말      298   ms      ← 같은 기능, 같은 사용자, 270배 차이
--
-- 즉 이 기능의 지연은 시스템 잡음이 아니라 **입력 분포**가 만든다. 평균을 내면
-- 75 ms 쯤 나오는데 그런 요청은 실제로 존재하지 않는다. 중앙값은 1 ms 이고,
-- 꼬리는 "흔한 낱말을 검색한 사람" 이다.
--
-- 왜 흔한 낱말이 300 ms 나 걸렸나. 원본은 이런 모양이었다.
--
--     select … from ( 다섯 테이블 union all ) r
--      where public.can_view_object(r.kind, r.id)      ← 행마다 함수 호출
--      order by r.rank desc limit 30
--
-- 두 가지가 겹쳐 있다.
--   1) can_view_object 는 SECURITY DEFINER plpgsql 이라 플래너가 인라인할 수
--      없다. 후보 3,000행이면 **3,000번 호출**되고, 한 번마다 인덱스 조회와
--      권한 서브쿼리를 다시 돈다(로그에서 한 호출이 0.69 ms 인 경우도 있었다).
--   2) 그 필터가 union **뒤에** 있어서, 버려질 행에 대해서도 스니펫
--      (jsonb_extract_text 로 문서 본문 전체를 훑는다)을 이미 다 계산한 뒤였다.
--
-- 고친 방향은 캘린더(0071)와 같다 — "행마다 다시" 를 "한 번에 집합으로" 로.
--   * 권한 조건을 각 브랜치 안으로 밀어 넣어 인덱스와 함께 평가되게 했다.
--     can_view_object 의 논리를 그대로 옮겨 적었다(이 함수도 SECURITY DEFINER
--     이므로 권한 수준은 동일하다).
--   * 브랜치마다 order by … limit 30 을 붙였다. 전체 상위 30개를 고르는데 한
--     브랜치가 30개 넘게 기여할 수 없으므로 결과는 정확히 같고, 정렬은
--     Top-N 으로 바뀐다.
--   * 스니펫은 **살아남은 30행에만** 계산한다. 본문을 훑는 비용을 3,000번에서
--     30번으로 줄인다.
-- ============================================================================

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

  -- 쿼리당 한 번. 전에는 행마다 is_admin() 이 다시 돌았다.
  v_uid := auth.uid();
  v_admin := public.is_admin();

  return query
  with hits as (
    (select 'document'::text as kind, d.id, d.title,
            ts_rank(d.search_vector, v_tsquery) as rank, d.updated_at
       from public.documents d
      where d.search_vector @@ v_tsquery
        and (v_admin or d.owner_id = v_uid or d.is_public
             or exists(select 1 from public.document_permissions dp
                        where dp.document_id = d.id and dp.user_id = v_uid))
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
  -- 스니펫은 여기서, 30행에만.
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
