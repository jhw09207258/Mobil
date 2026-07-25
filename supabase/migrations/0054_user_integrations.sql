-- ============================================================================
-- 외부 서비스 연동 토큰 — Code Space 를 GitHub 로 내보내고 Vercel 로 배포하며,
-- 에이전트가 Supabase 프로젝트를 알고 코드를 짜게 하기 위한 자격증명.
--
-- 토큰은 진짜 비밀이므로:
--   * RLS 로 본인만 읽고 쓴다. is_admin() 도 제외 — 관리자가 남의 PAT 를
--     읽을 이유가 없다(다른 테이블과 달리 admin 우회를 일부러 넣지 않았다).
--   * 서버에서만 쓰고 클라이언트로는 절대 돌려주지 않는다(끝 4자리만 노출).
-- ============================================================================

create table public.user_integrations (
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('github', 'vercel', 'supabase')),
  token text not null,
  -- github: 로그인명 / vercel: 팀 슬러그 / supabase: 프로젝트 ref
  account text,
  -- supabase 연동에서 에이전트에게 알려줄 공개 정보(프로젝트 URL, anon key 등).
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table public.user_integrations enable row level security;

create policy user_integrations_select on public.user_integrations for select
using (user_id = (select auth.uid()));

create policy user_integrations_insert on public.user_integrations for insert
with check (user_id = (select auth.uid()));

create policy user_integrations_update on public.user_integrations for update
using (user_id = (select auth.uid()));

create policy user_integrations_delete on public.user_integrations for delete
using (user_id = (select auth.uid()));

-- Code Space 를 GitHub 저장소로 내보낸 뒤 그 연결을 기억한다(재푸시용).
alter table public.code_repositories
  add column if not exists github_pushed_at timestamptz;
