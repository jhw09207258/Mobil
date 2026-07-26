-- ============================================================================
-- 에이전트가 고친 코드 파일을, 그 파일을 열어 둔 편집기들에 즉시 밀어준다.
--
-- 페이로드는 증분 Yjs 업데이트다. 클라이언트(lib/yjs-transport.ts)가 이미
-- `yupdate` 이벤트를 처리하므로 편집기 쪽 코드는 손대지 않아도 된다.
--
-- 트리거가 아니라 명시 호출인 이유: 트리거로 걸면 편집기 자신의 저장까지
-- 브로드캐스트로 되돌아와 루프가 된다. 에이전트 경로만 이 함수를 부른다.
-- ============================================================================
create or replace function public.broadcast_code_yupdate(p_file_id uuid, p_update text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- 남의 파일 채널에 주입하지 못하게 소유권을 확인한다.
  if not exists (
    select 1 from public.code_files
    where id = p_file_id and owner_id = (select auth.uid())
  ) then
    raise exception 'Not allowed to broadcast for this file';
  end if;

  begin
    perform realtime.send(
      jsonb_build_object('u', p_update),
      'yupdate',
      'code:' || p_file_id::text,
      true
    );
  exception when others then
    null; -- 알림 실패가 파일 저장을 되돌리면 안 된다.
  end;
end;
$function$;

revoke all on function public.broadcast_code_yupdate(uuid, text) from public;
grant execute on function public.broadcast_code_yupdate(uuid, text) to authenticated;
revoke execute on function public.broadcast_code_yupdate(uuid, text) from anon;
