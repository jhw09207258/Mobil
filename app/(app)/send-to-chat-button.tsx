"use client";

import { useCallback, useState } from "react";
import { ShareToChatDialog } from "@/components/share-to-chat-dialog";
import { IconChat } from "./icons";
import { listChatContacts, listChatConversations, startDm } from "./chat/actions";
import { sendItemToChat, type ObjectKind } from "./sharing/actions";

/**
 * 어느 목록/에디터에서든 붙일 수 있는 "채팅으로 보내기" 버튼.
 *
 * 자료를 찾은 자리에서 바로 보낼 수 있어야 한다. 지금까지는 채팅으로 가서
 * 첨부 메뉴를 열고 목록에서 다시 찾아야 했고, 그마저도 권한은 따로 줘야 했다.
 */
export function SendToChatButton({
  kind,
  id,
  title,
  className = "btn btn-ghost btn-sm",
  label = "Send to chat",
  iconOnly = false,
  canGrant = true,
}: {
  kind: ObjectKind;
  id: string;
  title: string;
  className?: string;
  label?: string;
  iconOnly?: boolean;
  /** 내가 소유자가 아니면 권한 선택을 감춘다. */
  canGrant?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const loadTargets = useCallback(async () => {
    const [conversations, contacts] = await Promise.all([
      listChatConversations(),
      listChatContacts(),
    ]);
    return {
      conversations: conversations.map((c) => ({
        id: c.id,
        title: c.title,
        kind: c.kind,
        avatar_url: c.avatar_url,
        member_count: c.member_count,
      })),
      contacts,
    };
  }, []);

  const onSend = useCallback(
    (conversationId: string, note: string, permission: "view" | "edit") =>
      sendItemToChat(kind, id, title, conversationId, note, permission),
    [kind, id, title]
  );

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={(e) => {
          // 목록의 행 클릭(열기)과 겹치지 않게.
          e.stopPropagation();
          setOpen(true);
        }}
        title={label}
        aria-label={label}
      >
        <IconChat size={13} />
        {!iconOnly && label}
      </button>
      {open && (
        <ShareToChatDialog
          itemLabel={title || "Untitled"}
          itemKind={kind}
          canGrantHint={canGrant}
          loadTargets={loadTargets}
          onSend={onSend}
          onStartDm={startDm}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
