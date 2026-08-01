-- ============================================================================
-- Storage locality — Repository 영역의 불필요한 I/O 제거.
-- ----------------------------------------------------------------------------
-- 1) list_code_repositories(): 지금까지 앱(app/(app)/code/repo-actions.ts)은
--    저장소 목록을 한 번 읽고, 저장소별 파일 수를 세려고 code_files 의
--    code_repository_id 컬럼을 "전체 행" 긁어와 자바스크립트에서 세었다.
--    파일이 수천 개면 카운트 하나 보려고 수천 행을 네트워크로 옮기는
--    셈이다 — 집계는 DB 안에서 끝내고 결과(저장소 수만큼의 행)만 돌려준다.
--    SECURITY DEFINER 가 아니다 — 호출자 권한 그대로 두 테이블의 기존 RLS
--    (code_repositories_select/code_files_select)가 그대로 걸린다.
--
-- 2) list_repository_contents(): repositories(문서·코드·시트·맵 범용 저장소,
--    0044)의 내용물을 documents/code_files/sheets/mind_maps 네 테이블에
--    각각 따로 쿼리하던 것(app/(app)/repositories/actions.ts, Promise.all 로
--    병렬화는 되어 있었지만 왕복은 여전히 4번)을 UNION ALL 로 한 번에
--    묶는다 — 이미 list_attachable_objects(0065)가 쓰는 것과 같은 방식.
-- ============================================================================

create or replace function public.list_code_repositories()
returns table (
  id uuid,
  name text,
  github_owner text,
  github_repo text,
  github_ref text,
  imported_at timestamptz,
  created_at timestamptz,
  file_count int
)
language sql
stable
set search_path = public
as $$
  select cr.id, cr.name, cr.github_owner, cr.github_repo, cr.github_ref,
         cr.imported_at, cr.created_at,
         count(cf.id)::int as file_count
    from public.code_repositories cr
    left join public.code_files cf on cf.code_repository_id = cr.id
   group by cr.id
   order by cr.created_at desc;
$$;

revoke all on function public.list_code_repositories() from public, anon;
grant execute on function public.list_code_repositories() to authenticated;

create or replace function public.list_repository_contents(p_repository uuid default null)
returns table (kind text, id uuid, label text)
language sql
stable
set search_path = public
as $$
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
   limit 100);
$$;

revoke all on function public.list_repository_contents(uuid) from public, anon;
grant execute on function public.list_repository_contents(uuid) to authenticated;
