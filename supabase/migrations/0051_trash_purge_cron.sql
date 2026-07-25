-- ============================================================================
-- 휴지통 자동 비우기 — 매시 정각에 18시간 지난 항목을 영구 삭제.
-- purge_expired_trash() 는 0050 에서 정의(파일은 storage.objects 를 먼저 지워
-- 스토리지 고아 객체를 남기지 않는다).
-- ============================================================================
create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'purge-expired-trash';
select cron.schedule('purge-expired-trash', '0 * * * *', $$select public.purge_expired_trash()$$);
