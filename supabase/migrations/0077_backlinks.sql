-- ============================================================================
-- 백링크 — "이 문서를 가리키는 다른 것들"만 보여준다(Obsidian 의 Backlinks
-- 패널과 같은 개념).
-- ----------------------------------------------------------------------------
-- get_linked_objects(0015)는 이미 있지만 양방향(내가 건 링크 + 나를 가리키는
-- 링크)을 한데 섞어 돌려준다 — header-search.tsx 의 "연결된 항목" 처럼
-- 방향을 굳이 가릴 필요가 없는 자리에는 맞지만, Obsidian 의 백링크 패널이
-- 유용한 이유는 정확히 그 반대다: 문서 본문을 아무리 읽어도 "누가 나를
-- 참조하고 있는지"는 알 수 없다(내가 건 링크는 본문에 칩으로 이미 보인다).
-- 그래서 들어오는 방향만 걸러내는 별도 함수를 둔다 — get_linked_objects 처럼
-- 다단계로 펴지 않는다(Obsidian 기본 백링크 패널도 1단계다).
-- ============================================================================

create or replace function public.get_backlinks(p_kind text, p_id uuid)
returns table(kind text, id uuid, title text, link_source text)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.can_view_object(p_kind, p_id) then
    return;
  end if;

  return query
    select ol.from_kind, ol.from_id,
           case ol.from_kind
             when 'document' then (select d.title from public.documents d where d.id = ol.from_id)
             when 'code' then (select c.name from public.code_files c where c.id = ol.from_id)
             when 'sheet' then (select s.title from public.sheets s where s.id = ol.from_id)
             when 'mindmap' then (select m.title from public.mind_maps m where m.id = ol.from_id)
             when 'file' then (select f.file_name from public.files f where f.id = ol.from_id)
           end,
           ol.source
      from public.object_links ol
     where ol.to_kind = p_kind and ol.to_id = p_id
       and public.can_view_object(ol.from_kind, ol.from_id)
       and case ol.from_kind
             when 'document' then exists(select 1 from public.documents d where d.id = ol.from_id)
             when 'code' then exists(select 1 from public.code_files c where c.id = ol.from_id)
             when 'sheet' then exists(select 1 from public.sheets s where s.id = ol.from_id)
             when 'mindmap' then exists(select 1 from public.mind_maps m where m.id = ol.from_id)
             when 'file' then exists(select 1 from public.files f where f.id = ol.from_id)
           end
     order by ol.from_kind, 3;
end;
$$;

revoke all on function public.get_backlinks(text, uuid) from public, anon;
grant execute on function public.get_backlinks(text, uuid) to authenticated;
