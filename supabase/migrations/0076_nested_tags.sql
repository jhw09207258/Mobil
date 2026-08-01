-- ============================================================================
-- 중첩 태그 — #parent 로 찾으면 #parent/child 도 함께 나온다.
-- ----------------------------------------------------------------------------
-- lib/tags.ts 가 이제 "#parent/child" 를 하나의 태그 이름으로 뽑는다
-- (parent/child, "/" 로 최대 5단). 저장(sync_object_tags)은 태그 이름을
-- 그대로 문자열로 넣을 뿐이라 이미 그대로 동작한다 — 계층은 "/" 로 적은
-- 경로 자체일 뿐, 별도의 부모-자식 테이블이 없다(MediaWiki/Logseq 식의
-- 명시적 포함관계 선언과 다르다, 사용자 요청대로 단순하게 유지).
--
-- 하지만 조회(search_by_tag)는 지금까지 이름을 정확히 일치(=)해서만
-- 찾았다 — "#work" 로 검색해도 "work/possion" 태그가 붙은 문서는 안 나왔다.
-- 부모 이름과 정확히 같거나, 그 뒤에 "/" 로 이어지는 이름이면(자식) 함께
-- 찾도록 바꾼다. "work/poss" 처럼 겉보기에 접두어가 같아 보여도 구분자
-- "/" 가 없으면 매치되지 않아야 하므로("possion" 을 "poss" 검색으로
-- 우연히 찾으면 안 된다) v_name || '/%' 로 반드시 "/" 를 넣는다.
-- ============================================================================

create or replace function public.search_by_tag(p_tag text)
returns table(kind text, id uuid, title text, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_name text := lower(trim(both '#' from trim(p_tag)));
begin
  if v_name is null or length(v_name) = 0 then
    return;
  end if;

  return query
    select
      ot.kind,
      ot.object_id,
      case ot.kind
        when 'document' then (select d.title from public.documents d where d.id = ot.object_id)
        when 'code' then (select c.name from public.code_files c where c.id = ot.object_id)
        when 'sheet' then (select s.title from public.sheets s where s.id = ot.object_id)
        when 'mindmap' then (select m.title from public.mind_maps m where m.id = ot.object_id)
        when 'file' then (select f.file_name from public.files f where f.id = ot.object_id)
      end as title,
      case ot.kind
        when 'document' then (select d.updated_at from public.documents d where d.id = ot.object_id)
        when 'code' then (select c.updated_at from public.code_files c where c.id = ot.object_id)
        when 'sheet' then (select s.updated_at from public.sheets s where s.id = ot.object_id)
        when 'mindmap' then (select m.updated_at from public.mind_maps m where m.id = ot.object_id)
        when 'file' then (select f.created_at from public.files f where f.id = ot.object_id)
      end as updated_at
    from public.object_tags ot
    join public.tags t on t.id = ot.tag_id
    where (t.name = v_name or t.name like v_name || '/%')
      and public.can_view_object(ot.kind, ot.object_id)
    order by 4 desc nulls last
    limit 50;
end;
$$;

revoke all on function public.search_by_tag(text) from public, anon;
grant execute on function public.search_by_tag(text) to authenticated;
