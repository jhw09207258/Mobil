import { requireUser } from "@/lib/auth";
import { listChatContacts } from "../chat/actions";
import { ensureDefaultCalendar, listCalendars } from "./actions";
import { CalendarShell } from "./calendar-shell";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const { userId } = await requireUser();

  // 처음 들어오면 기본 달력이 하나 있어야 한다 — 빈 화면에서 "먼저 달력을
  // 만드세요" 를 요구하지 않는다.
  await ensureDefaultCalendar();
  const [calendars, contacts] = await Promise.all([listCalendars(), listChatContacts()]);

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
