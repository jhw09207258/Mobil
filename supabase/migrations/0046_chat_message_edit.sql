-- ============================================================================
-- 채팅 메시지 편집 지원 — 발신자가 자기 메시지를 수정할 수 있게 UPDATE 정책과
-- edited_at 컬럼을 추가한다. 삭제는 이미 0040 의 delete 정책으로 가능하다.
-- ============================================================================

alter table public.chat_messages
  add column if not exists edited_at timestamptz;

-- 발신자만 자기 메시지의 content 를 수정할 수 있다(멤버십은 이미 보장됨).
create policy chat_messages_update on public.chat_messages for update
using (sender_id = (select auth.uid()))
with check (sender_id = (select auth.uid()));

-- get_chat_messages 가 edited_at 을 반환하도록 재정의(반환 타입 변경 → drop 필요).
drop function if exists public.get_chat_messages(uuid, int);
create function public.get_chat_messages(p_conversation uuid, p_limit int default 200)
returns table (
  id uuid,
  sender_id uuid,
  sender_name text,
  sender_avatar_url text,
  content text,
  created_at timestamptz,
  edited_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select m.id, m.sender_id,
         coalesce(p.display_name, p.email) as sender_name,
         p.avatar_url as sender_avatar_url,
         m.content, m.created_at, m.edited_at
  from public.chat_messages m
  join public.profiles p on p.id = m.sender_id
  where m.conversation_id = p_conversation
    and public.is_chat_member(p_conversation)
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

revoke all on function public.get_chat_messages(uuid, int) from public, anon;
grant execute on function public.get_chat_messages(uuid, int) to authenticated;
