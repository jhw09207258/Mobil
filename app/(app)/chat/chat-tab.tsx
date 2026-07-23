"use client";

import { useEffect, useState } from "react";
import { getChatBootstrap } from "./actions";
import { ChatShell } from "./chat-shell";

type Bootstrap = Awaited<ReturnType<typeof getChatBootstrap>>;

/** 워크스페이스 탭(스플릿 뷰)용 채팅 — float variant 로 한 칸(목록↔스레드)
 * 레이아웃을 써서 좁은 패널 폭에서도 안전하다. */
export function ChatTab() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getChatBootstrap()
      .then((b) => {
        if (!cancelled) setBoot(b);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="wk-loading">
        <div className="notice notice-error" style={{ margin: 16 }}>
          Failed to load chat.
        </div>
      </div>
    );
  }
  if (!boot) return <div className="wk-loading">Loading…</div>;

  return (
    <ChatShell
      selfId={boot.selfId}
      selfName={boot.selfName}
      initialConversations={boot.conversations}
      contacts={boot.contacts}
      variant="float"
    />
  );
}
