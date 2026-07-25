-- ============================================================================
-- 코드 파일은 Code Space 안에서만 존재한다 — 낱개(standalone) 코드 파일 개념을
-- 없앤다. 코드는 항상 프로젝트 맥락에서 다뤄지고, 에이전트도 Code Space 단위로
-- 동작하므로 소속 없는 파일은 어디에도 나타날 자리가 없다.
--
-- 태그·임베딩·링크·즐겨찾기는 (kind, object_id) 다형성 참조라 FK 가 없다.
-- 즉 code_files 를 지워도 자동으로 안 지워지므로 직접 정리한다.
-- (code_file_permissions 만 FK ON DELETE CASCADE 라 알아서 따라간다.)
-- ============================================================================

do $$
declare doomed uuid[];
begin
  select array_agg(id) into doomed
  from public.code_files where code_repository_id is null;

  if doomed is not null then
    delete from public.object_tags       where kind = 'code' and object_id = any(doomed);
    delete from public.object_embeddings where kind = 'code' and object_id = any(doomed);
    delete from public.object_links      where (from_kind = 'code' and from_id = any(doomed))
                                            or (to_kind   = 'code' and to_id   = any(doomed));
    delete from public.starred_items     where kind = 'code' and object_id = any(doomed);
    delete from public.code_files where id = any(doomed);
  end if;
end $$;

alter table public.code_files
  alter column code_repository_id set not null;

-- path 는 트리 표시와 에이전트 커밋(경로로 파일을 찾는다)의 키라 항상 있어야 한다.
update public.code_files set path = name where path is null or path = '';
alter table public.code_files
  alter column path set not null;
