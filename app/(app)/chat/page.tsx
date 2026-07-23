import { requireUser } from "@/lib/auth";
import { listChatConversations, listChatContacts } from "./actions";
import { ChatShell } from "./chat-shell";
import { OpenItemButton } from "../workspace/open-item-button";

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
        <div className="row" style={{ gap: 12 }}>
          <OpenItemButton kind="chat" id="comms" title="Comms" className="btn btn-sm">
            Open as tab (split view)
          </OpenItemButton>
          <span className="crumb">WORKSPACE / COMMS</span>
        </div>
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
