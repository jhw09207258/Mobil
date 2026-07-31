-- ============================================================================
-- 프로덕션 계측 — 기능별 응답시간 표본을 실제 배포에서 쌓는다.
--
-- v1.6.4 에서 잰 백분위는 전부 로컬 재현 환경 값이었다("배포 환경의 실제
-- 분포가 필요합니다" 라고 그때 적어 두었다). 이 마이그레이션은 그 분포를
-- 실제로 쌓을 자리를 만든다 — Server Action 이 끝난 뒤(lib/observability.ts
-- 의 measure(), Next 의 after() 로 응답을 막지 않고) 표본 하나를 여기 남긴다.
--
-- 설계 원칙 세 가지.
--   1) 계측이 계측 대상을 부풀리면 안 된다. 표본 기록은 항상 샘플링되고
--      (feature 마다 다른 비율 — lib/slo.ts) after() 로 응답 이후에 붙는다.
--   2) 계측 실패가 기능 실패가 되면 안 된다. record_perf_sample 은 잘못된
--      입력을 조용히 버리고, 호출부도 실패를 무시한다.
--   3) 무한히 쌓이면 안 된다. trash 자동 비우기(0051)와 같은 pg_cron 패턴으로
--      30일 지난 표본을 매시 지운다.
-- ============================================================================

create table public.perf_samples (
  id bigserial primary key,
  feature text not null,
  ms real not null,
  created_at timestamptz not null default now()
);

-- 기간별 백분위 계산(feature, created_at 범위)과 정리(created_at) 양쪽에 쓴다.
create index perf_samples_feature_time_idx on public.perf_samples (feature, created_at desc);
create index perf_samples_created_idx on public.perf_samples (created_at);

alter table public.perf_samples enable row level security;

-- app_secrets(0069)와 같은 패턴 — 테이블에는 아무도 직접 닿지 못하고,
-- 아래 두 SECURITY DEFINER 함수를 통해서만 쓰고 읽는다.
create policy perf_samples_no_direct_access on public.perf_samples for all using (false);

-- ----------------------------------------------------------------------------
-- 기록. 로그인 화면처럼 인증 이전 경로의 지연도 재고 싶으므로 anon 도 부를 수
-- 있다 — 그래서 입력을 강하게 자른다: feature 는 64자 이하, ms 는 5분(값이
-- 이 이상이면 계측 자체가 잘못됐다고 본다) 이하의 음이 아닌 값만 받는다.
-- 실패해도 예외를 던지지 않고 조용히 버린다 — 호출부(after() 안)가 이 함수의
-- 결과를 아무도 기다리지 않으므로, 여기서 던지면 콘솔에 잡음만 남긴다.
-- ----------------------------------------------------------------------------
create or replace function public.record_perf_sample(p_feature text, p_ms real)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_feature is null or length(p_feature) = 0 or length(p_feature) > 64 then
    return;
  end if;
  if p_ms is null or p_ms < 0 or p_ms > 300000 then
    return;
  end if;
  insert into public.perf_samples (feature, ms) values (p_feature, p_ms);
end;
$$;

revoke all on function public.record_perf_sample(text, real) from public;
grant execute on function public.record_perf_sample(text, real) to authenticated, anon;

-- ----------------------------------------------------------------------------
-- 조회 — 관리자만. 백분위와 이상치 비율을 함께 돌려준다(산술평균 없음 —
-- README·v1.6.4 감사 결과와 같은 원칙). p999 는 표본이 적으면 신뢰할 수 없으므로
-- n 을 항상 같이 돌려준다.
-- ----------------------------------------------------------------------------
create or replace function public.get_perf_percentiles(p_window_hours int default 24)
returns table (
  feature text,
  n bigint,
  p50 real,
  p90 real,
  p95 real,
  p99 real,
  p999 real,
  max_ms real,
  outlier_pct real
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_hours int := greatest(1, least(coalesce(p_window_hours, 24), 24 * 30));
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;

  -- perf_samples.feature 를 아래 select 에서 그냥 "feature" 로 쓰면 안 된다 —
  -- returns table(feature text, ...) 의 각 컬럼명은 이 함수 본문 전체에서
  -- 암묵적으로 plpgsql 변수로도 선언되므로, 같은 이름의 테이블 컬럼을 별칭 없이
  -- 쓰면 "column reference is ambiguous" 로 막힌다. ps.* 로 항상 한정한다.
  return query
  with s as (
    select ps.feature, ps.ms
      from public.perf_samples ps
     where ps.created_at >= now() - make_interval(hours => v_hours)
  ),
  q as (
    select s.feature,
           count(*) as n,
           percentile_cont(0.50) within group (order by s.ms) as p50,
           percentile_cont(0.90) within group (order by s.ms) as p90,
           percentile_cont(0.95) within group (order by s.ms) as p95,
           percentile_cont(0.99) within group (order by s.ms) as p99,
           percentile_cont(0.999) within group (order by s.ms) as p999,
           max(s.ms) as mx,
           percentile_cont(0.75) within group (order by s.ms) as q3,
           percentile_cont(0.25) within group (order by s.ms) as q1
      from s
     group by s.feature
  )
  -- percentile_cont() 는 입력이 real 이어도 항상 double precision 을 돌려준다
  -- (interval 이 아닌 한). returns table 의 선언 타입(real)과 맞추려면 여기서
  -- 명시적으로 캐스팅해야 한다 — 안 하면 "structure of query does not match
  -- function result type" 으로 막힌다.
  select q.feature, q.n,
         q.p50::real, q.p90::real, q.p95::real, q.p99::real, q.p999::real,
         q.mx::real,
         (select ((count(*)::real / nullif(q.n, 0)) * 100)::real
            from s
           where s.feature = q.feature
             and s.ms > (q.q3 + 1.5 * (q.q3 - q.q1))) as outlier_pct
    from q
   order by q.p999 desc nulls last;
end;
$$;

revoke all on function public.get_perf_percentiles(int) from public, anon;
grant execute on function public.get_perf_percentiles(int) to authenticated;

-- ----------------------------------------------------------------------------
-- 30일 지난 표본은 매시 정각에 지운다 — trash 자동 비우기(0051)와 같은 방식.
-- ----------------------------------------------------------------------------
create or replace function public.purge_old_perf_samples()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.perf_samples where created_at < now() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.purge_old_perf_samples() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'purge-old-perf-samples';
select cron.schedule('purge-old-perf-samples', '0 * * * *', $$select public.purge_old_perf_samples()$$);
