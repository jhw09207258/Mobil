-- ============================================================================
-- Plugin — 대화에 "연결한" 작업 대상.
--
-- 지금까지 어시스턴트는 매번 검색으로 대상을 추측했다. 잘못 고르면 엉뚱한
-- 문서를 덮어쓰고, 매 턴 검색 토큰도 나간다. 여기에 붙여 두면 어시스턴트가
-- id 를 바로 알고 작업한다.
--
-- 대상은 다형성(kind, object_id)이라 FK 를 못 건다 — 삭제된 항목은 조회 시
-- lateral 조인이 비면서 자연스럽게 빠진다(유령 첨부가 남지 않는다).
-- ============================================================================
create table public.ai_conversation_plugins (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  kind text not null check (kind in ('document', 'code', 'sheet', 'mindmap', 'repository', 'code_space')),
  object_id uuid not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, kind, object_id)
);

create index ai_conversation_plugins_conv_idx
  on public.ai_conversation_plugins (conversation_id);

alter table public.ai_conversation_plugins enable row level security;

create policy ai_conversation_plugins_select on public.ai_conversation_plugins for select
using (exists (
  select 1 from public.ai_conversations c
  where c.id = conversation_id and c.owner_id = (select auth.uid())
));

create policy ai_conversation_plugins_insert on public.ai_conversation_plugins for insert
with check (exists (
  select 1 from public.ai_conversations c
  where c.id = conversation_id and c.owner_id = (select auth.uid())
));

create policy ai_conversation_plugins_delete on public.ai_conversation_plugins for delete
using (exists (
  select 1 from public.ai_conversations c
  where c.id = conversation_id and c.owner_id = (select auth.uid())
));

-- 붙은 항목의 제목을 종류별 테이블에서 한 번에 모아 준다.
create or replace function public.list_conversation_plugins(p_conversation_id uuid)
returns table(kind text, object_id uuid, title text, subtitle text)
language sql stable security definer set search_path to 'public'
as $function$
  select p.kind, p.object_id, t.title, t.subtitle
  from public.ai_conversation_plugins p
  join public.ai_conversations c on c.id = p.conversation_id
  join lateral (
    select d.title, null::text as subtitle
    from public.documents d
    where p.kind = 'document' and d.id = p.object_id and d.deleted_at is null
    union all
    select f.name, f.path
    from public.code_files f
    where p.kind = 'code' and f.id = p.object_id and f.deleted_at is null
    union all
    select s.title, null::text
    from public.sheets s
    where p.kind = 'sheet' and s.id = p.object_id and s.deleted_at is null
    union all
    select m.title, null::text
    from public.mind_maps m
    where p.kind = 'mindmap' and m.id = p.object_id and m.deleted_at is null
    union all
    select r.name, null::text
    from public.repositories r
    where p.kind = 'repository' and r.id = p.object_id
    union all
    select cr.name, coalesce(cr.github_owner || '/' || cr.github_repo, null)
    from public.code_repositories cr
    where p.kind = 'code_space' and cr.id = p.object_id and cr.deleted_at is null
  ) t on true
  where p.conversation_id = p_conversation_id
    and c.owner_id = (select auth.uid())
  order by p.created_at;
$function$;

revoke all on function public.list_conversation_plugins(uuid) from public, anon;
grant execute on function public.list_conversation_plugins(uuid) to authenticated;
