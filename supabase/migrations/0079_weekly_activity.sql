-- ============================================================================
-- 대시보드 "이번 주" 막대그래프용 — 최근 7일간 내가 만든 항목 수(일자별).
-- ----------------------------------------------------------------------------
-- my_content_breakdown()(0013)과 같은 원칙: 문서/코드/시트/마인드맵/파일
-- 다섯 종류를 하나의 결과로 합친다. 여기서는 용량이 아니라 "그 날 만든
-- 개수" 를 센다. generate_series 로 최근 7일을 먼저 만들어 두고 LEFT JOIN
-- 하므로, 하루도 안 만든 날도 0으로 나온다(막대그래프가 빈 날을 건너뛰지
-- 않고 그대로 보여줘야 한다).
-- ============================================================================

create or replace function public.my_weekly_activity()
returns table(day date, item_count int)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
begin
  return query
    with days as (
      select generate_series(current_date - 6, current_date, interval '1 day')::date as day
    ),
    items as (
      select d.created_at::date as day from public.documents d
       where d.owner_id = v_uid and d.deleted_at is null and d.created_at >= current_date - 6
      union all
      select c.created_at::date from public.code_files c
       where c.owner_id = v_uid and c.deleted_at is null and c.created_at >= current_date - 6
      union all
      select s.created_at::date from public.sheets s
       where s.owner_id = v_uid and s.deleted_at is null and s.created_at >= current_date - 6
      union all
      select m.created_at::date from public.mind_maps m
       where m.owner_id = v_uid and m.deleted_at is null and m.created_at >= current_date - 6
      union all
      select f.created_at::date from public.files f
       where f.owner_id = v_uid and f.deleted_at is null and f.created_at >= current_date - 6
    )
    select d.day, count(i.day)::int
      from days d
      left join items i on i.day = d.day
     group by d.day
     order by d.day;
end;
$$;

revoke all on function public.my_weekly_activity() from public, anon;
grant execute on function public.my_weekly_activity() to authenticated;
