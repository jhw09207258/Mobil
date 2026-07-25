-- ============================================================================
-- Code Repository — 기존 repositories(문서·시트·맵·파일 범용 저장소)와 별개.
-- 코드는 폴더 경로가 있어야 GitHub 처럼 트리로 보여줄 수 있고, GitHub 출처를
-- 기억해야 재임포트가 가능하므로 전용 테이블을 둔다.
-- code_files 에는 컬럼 2개만 추가하므로 기존 코드 파일/공유/협업은 그대로다.
-- ============================================================================

create table public.code_repositories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  github_owner text,
  github_repo text,
  github_ref text,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index code_repositories_owner_idx on public.code_repositories (owner_id, created_at desc);
create index code_repositories_trash_idx on public.code_repositories (deleted_at) where deleted_at is not null;

alter table public.code_repositories enable row level security;

create policy code_repositories_select on public.code_repositories for select
using (deleted_at is null and (owner_id = (select auth.uid()) or public.is_admin()));

create policy code_repositories_insert on public.code_repositories for insert
with check (owner_id = (select auth.uid()));

create policy code_repositories_update on public.code_repositories for update
using (owner_id = (select auth.uid()));

create policy code_repositories_delete on public.code_repositories for delete
using (owner_id = (select auth.uid()) or public.is_admin());

alter table public.code_files
  add column if not exists code_repository_id uuid references public.code_repositories(id) on delete set null;
alter table public.code_files
  add column if not exists path text;

create index if not exists code_files_code_repository_idx
  on public.code_files (code_repository_id) where code_repository_id is not null;
