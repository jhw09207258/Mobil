-- ============================================================================
-- 대시보드 "THIS WEEK" — 새로 만든 것뿐 아니라 이번 주에 손댄(수정한) 것까지.
-- ----------------------------------------------------------------------------
-- 0079 는 created_at 기준이라 "이번 주에 새로 만든 것"만 잡았다. 문서/코드/
-- 시트/마인드맵은 updated_at 이 생성 시점엔 created_at 과 같은 값으로 시작해
-- 그대로 두면 생성일이 여전히 잡히고, 그 뒤 수정하면 updated_at 이 오늘로
-- 올라와 오늘도 함께 잡힌다 — 기준 컬럼 하나만 바꿔서 추가+수정을 동시에
-- 담는다. files 는 updated_at 이 없다(재업로드 개념이 없어 만든 시점만
-- 의미 있다) — created_at 그대로 둔다.
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
      select d.updated_at::date as day from public.documents d
       where d.owner_id = v_uid and d.deleted_at is null and d.updated_at >= current_date - 6
       union all
      select c.updated_at::date from public.code_files c
       where c.owner_id = v_uid and c.deleted_at is null and c.updated_at >= current_date - 6
       union all
      select s.updated_at::date from public.sheets s
       where s.owner_id = v_uid and s.deleted_at is null and s.updated_at >= current_date - 6
       union all
      select m.updated_at::date from public.mind_maps m
       where m.owner_id = v_uid and m.deleted_at is null and m.updated_at >= current_date - 6
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
