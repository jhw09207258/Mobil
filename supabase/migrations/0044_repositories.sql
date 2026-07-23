-- ============================================================================
-- Repositories — 모든 콘텐츠(문서·코드·시트·마인드맵·파일)를 묶는 저장소 단위.
-- ----------------------------------------------------------------------------
-- 각 콘텐츠 테이블에 nullable repository_id 를 추가한다. NULL = "Null
-- Repository"(미분류) — 기존 행 전부가 자동으로 여기 속한다(별도 백필 불필요).
-- 저장소 자체는 소유자 전용(공유 개념 없음 — 공유는 기존 아이템 단위 공유
-- 체계를 그대로 사용). 아이템의 repository_id 변경은 각 테이블의 기존 UPDATE
-- RLS(소유자/편집 권한자)를 그대로 따른다.
-- ============================================================================

create table public.repositories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);
create index repositories_owner_idx on public.repositories (owner_id, created_at);

alter table public.repositories enable row level security;

create policy repositories_select on public.repositories for select
using (owner_id = (select auth.uid()) or public.is_admin());

create policy repositories_insert on public.repositories for insert
with check (owner_id = (select auth.uid()));

create policy repositories_update on public.repositories for update
using (owner_id = (select auth.uid()));

create policy repositories_delete on public.repositories for delete
using (owner_id = (select auth.uid()) or public.is_admin());

-- 콘텐츠 테이블에 저장소 연결 컬럼. 저장소 삭제 시 아이템은 지우지 않고
-- Null Repository 로 돌려보낸다(on delete set null — 데이터 유실 방지).
alter table public.documents  add column repository_id uuid references public.repositories(id) on delete set null;
alter table public.code_files add column repository_id uuid references public.repositories(id) on delete set null;
alter table public.sheets     add column repository_id uuid references public.repositories(id) on delete set null;
alter table public.mind_maps  add column repository_id uuid references public.repositories(id) on delete set null;
alter table public.files      add column repository_id uuid references public.repositories(id) on delete set null;

create index documents_repository_idx  on public.documents (repository_id);
create index code_files_repository_idx on public.code_files (repository_id);
create index sheets_repository_idx     on public.sheets (repository_id);
create index mind_maps_repository_idx  on public.mind_maps (repository_id);
create index files_repository_idx      on public.files (repository_id);
