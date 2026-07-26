-- ============================================================================
-- Agent 실행 기록 — Code Space 별 콘솔 세션.
--
-- 콘솔 내용이 메모리에만 있어서 화면을 나가면 통째로 사라졌다. 여기 남기면
-- 다시 들어왔을 때 이어지고, 무엇을 시켰고 무엇을 했는지가 기록으로 남는다.
--
-- lines 는 콘솔 줄 배열(jsonb) — 스키마가 UI 를 따라 자주 바뀌므로 컬럼으로
-- 쪼개지 않는다. 저장 시 최근 400줄만 남겨 행이 무한정 커지지 않게 한다.
-- ============================================================================
create table public.agent_runs (
  space_id uuid primary key references public.code_repositories(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  lines jsonb not null default '[]'::jsonb,
  interaction_id text,
  environment_id text,
  model text,
  turns int not null default 0,
  total_tokens bigint not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  status text not null default 'idle' check (status in ('idle', 'running', 'done', 'failed')),
  updated_at timestamptz not null default now()
);

create index agent_runs_owner_idx on public.agent_runs (owner_id, updated_at desc);

alter table public.agent_runs enable row level security;

create policy agent_runs_select on public.agent_runs for select
using (owner_id = (select auth.uid()));
create policy agent_runs_insert on public.agent_runs for insert
with check (owner_id = (select auth.uid()));
create policy agent_runs_update on public.agent_runs for update
using (owner_id = (select auth.uid()));
create policy agent_runs_delete on public.agent_runs for delete
using (owner_id = (select auth.uid()));
