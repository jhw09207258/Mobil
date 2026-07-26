-- ============================================================================
-- list_conversation_plugins 가시성 재검증 (드리프트 수정)
-- ----------------------------------------------------------------------------
-- ai_conversation_plugins 의 INSERT 정책(0058)은 "그 대화의 주인인가"만
-- 검사하고, 붙이려는 object_id 를 실제로 볼 수 있는지는 검사하지 않는다.
-- attachPlugin(app/(app)/sophia/plugin-actions.ts)의 주석은 "그 대상을 실제
-- 쓰는 도구(tools.ts)가 다시 RLS 로 걸러준다"고 가정하지만, 그건 읽기/쓰기
-- 도구에는 맞아도 이 목록 함수 자체에는 해당하지 않는다 — SECURITY DEFINER 로
-- documents/code_files/sheets/mind_maps/repositories/code_repositories 에
-- 곧장 조인해 title/subtitle 을 돌려주면서, can_view_object 급의 재검증이
-- 없었다.
--
-- 결과: 다른 사용자의 비공개 객체 UUID 를 어떻게든 알아낸 사람이(추측은 안
-- 되지만 공유 링크·에러 메시지 등으로 새어나올 수 있다) 그걸 자기 AI 대화에
-- 붙이면, 그 객체 내용에는 전혀 접근 못 해도 제목/부제만은 볼 수 있었다.
--
-- 고침: 각 종류(kind)별로 can_view_object 와 동일한 소유/공개/권한 조건을
-- LATERAL 조인의 where 절에 그대로 넣는다. 조건에 안 걸리면 그 lateral 이
-- 0행이 되어 해당 plugin 행 자체가 결과에서 통째로 빠진다(부분 노출 없음).
-- can_view_object 는 repository/code_space 종류를 모르므로(0015 작성 당시
-- 아직 없었다) 여기서는 공용 헬퍼를 확장하는 대신 이 함수 안에 직접 썼다 —
-- 더 널리 쓰이는 함수를 건드리는 것보다 범위가 좁고 안전하다.
-- ============================================================================
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
      and (d.owner_id = auth.uid() or d.is_public
           or exists(select 1 from public.document_permissions dp where dp.document_id = d.id and dp.user_id = auth.uid())
           or public.is_admin())
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
