import { requireUser } from "@/lib/auth";
import { listChatConversations, listChatContacts } from "./actions";
import { ChatShell } from "./chat-shell";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const { userId, email, profile } = await requireUser();
  const [conversations, contacts] = await Promise.all([
    listChatConversations(),
    listChatContacts(),
  ]);

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">Comms</span>
        <span className="crumb">WORKSPACE / COMMS</span>
      </div>
      <ChatShell
        selfId={userId}
        selfName={profile.display_name || email}
        initialConversations={conversations}
        contacts={contacts}
      />
    </>
  );
}
