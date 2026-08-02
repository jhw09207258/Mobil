import { requireUser } from "@/lib/auth";
import { listChatContacts } from "../chat/actions";
import { ensureDefaultCalendar, listCalendars } from "./actions";
import { CalendarShell } from "./calendar-shell";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const { userId } = await requireUser();

  // 처음 들어오면 기본 달력이 하나 있어야 한다 — 빈 화면에서 "먼저 달력을
  // 만드세요" 를 요구하지 않는다.
  //
  // 예전엔 ensure 를 먼저 await 하고 그 다음에 목록을 불렀다. 하지만 ensure 가
  // 실제로 뭔가 만드는 건 계정당 딱 한 번이고, 그 이후 모든 방문은 "아무것도
  // 안 함"에 DB 왕복 한 번(30ms 안팎)을 그대로 낸다. 셋을 같이 띄우고,
  // 목록이 비어 있을 때만 — 즉 진짜 첫 방문이거나 목록 조회가 ensure 의
  // 삽입보다 먼저 도착했을 때만 — 한 번 더 읽는다. 늘 내던 왕복을 첫 방문
  // 한 번으로 옮긴 것이다.
  const [, initialCalendars, contacts] = await Promise.all([
    ensureDefaultCalendar(),
    listCalendars(),
    listChatContacts(),
  ]);
  const calendars = initialCalendars.length > 0 ? initialCalendars : await listCalendars();

  return (
    <CalendarShell
      selfId={userId}
      initialCalendars={calendars}
      contacts={contacts.map((c) => ({
        id: c.id,
        name: c.display_name || c.email,
        email: c.email,
        avatar_url: c.avatar_url,
      }))}
    />
  );
}
