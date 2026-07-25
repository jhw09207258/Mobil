-- ============================================================================
-- 문서 편집 활동 로그 — 누가 언제 얼마나(추가/삭제) 고쳤는지 기록해 에디터
-- 우측 패널에 타임라인으로 보여준다. 자동저장마다 새 행을 만들면 시끄러우므로
-- 같은 사용자의 최근 5분 내 기록이 있으면 한 "편집 세션" 으로 누적한다.
-- ============================================================================

create table public.document_activity (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added int not null default 0,
  removed int not null default 0,
  preview text,
  created_at timestamptz not null default now()
);
create index document_activity_doc_idx on public.document_activity (document_id, created_at desc);

alter table public.document_activity enable row level security;
-- 폴리모픽 권한 판정을 함수로만 하므로 직접 접근은 차단(object_links 패턴).
create policy document_activity_no_direct on public.document_activity for all using (false);

-- 활동 기록(세션 병합). 편집 권한이 있는 문서에만 남긴다.
create or replace function public.log_document_activity(
  p_doc uuid, p_added int, p_removed int, p_preview text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_last uuid;
  v_last_at timestamptz;
begin
  if v_uid is null then return; end if;
  if not public.can_edit_object('document', p_doc) then return; end if;
  if coalesce(p_added, 0) = 0 and coalesce(p_removed, 0) = 0 then return; end if;

  select id, created_at into v_last, v_last_at
  from public.document_activity
  where document_id = p_doc and user_id = v_uid
  order by created_at desc limit 1;

  if v_last is not null and now() - v_last_at < interval '5 minutes' then
    update public.document_activity
       set added = added + p_added,
           removed = removed + p_removed,
           preview = coalesce(nullif(p_preview, ''), preview),
           created_at = now()
     where id = v_last;
  else
    insert into public.document_activity (document_id, user_id, added, removed, preview)
    values (p_doc, v_uid, p_added, p_removed, nullif(p_preview, ''));
  end if;
end;
$$;

revoke all on function public.log_document_activity(uuid, int, int, text) from public, anon;
grant execute on function public.log_document_activity(uuid, int, int, text) to authenticated;

-- 활동 조회(문서 열람 권한자 전용) — 사용자 이름/아바타 조인.
create or replace function public.get_document_activity(p_doc uuid, p_limit int default 60)
returns table (
  id uuid,
  user_id uuid,
  user_name text,
  avatar_url text,
  added int,
  removed int,
  preview text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select a.id, a.user_id,
         coalesce(p.display_name, p.email) as user_name,
         p.avatar_url, a.added, a.removed, a.preview, a.created_at
  from public.document_activity a
  join public.profiles p on p.id = a.user_id
  where a.document_id = p_doc
    and public.can_view_object('document', p_doc)
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 60), 1), 200);
$$;

revoke all on function public.get_document_activity(uuid, int) from public, anon;
grant execute on function public.get_document_activity(uuid, int) to authenticated;
