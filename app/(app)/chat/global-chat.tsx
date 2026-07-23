"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { UserAvatar } from "@/components/user-avatar";
import { ChatShell } from "./chat-shell";
import {
  listChatConversations,
  listChatContacts,
  type ChatContact,
  type ChatConversation,
} from "./actions";
import {
  emitMessageNotify,
  getActiveConversation,
  requestOpenConversation,
} from "./chat-bus";
import { useWorkspace } from "../workspace/workspace-context";
import "./chat.css";

type Toast = {
  id: string;
  conversationId: string;
  senderName: string;
  senderAvatarUrl: string | null;
  preview: string;
};

type FanoutPayload = {
  conversation_id?: string;
  message_id?: string;
  sender_id?: string;
  sender_name?: string;
  sender_avatar_url?: string | null;
  preview?: string;
};

const TOAST_TTL_MS = 6000;
const MAX_TOASTS = 3;

// fanout preview 는 원문 앞 140자 — 토스트에는 마크다운/토큰을 걷어내고 보여준다.
function cleanPreview(raw: string): string {
  return raw
    .replace(/!\[[^\]\n]*\]\([^)\s]*\)?/g, "🖼 photo")
    .replace(/\[\[[^\]]*\]?\]?/g, "⛓ attachment")
    .replace(/```/g, "")
    .replace(/[*_~`]/g, "")
    .replace(/\n+/g, " ")
    .trim();
}

/**
 * 앱 어디서나 떠 있는 채팅 — 우하단 버블(안 읽음 배지) ↔ 플로팅 패널
 * (compact/expanded 크기 전환, 최소화). 개인 topic(`user:<id>`, DB 트리거가
 * fanout)을 구독해 새 메시지를 인스타 스타일 토스트로 즉시 알린다.
 * 지금 보고 있는 대화의 메시지는 토스트를 띄우지 않는다(스레드가 이미 표시).
 */
export function GlobalChat({ selfId, selfName }: { selfId: string; selfName: string }) {
  const pathname = usePathname();
  const { openTab } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [unread, setUnread] = useState(0);
  const [data, setData] = useState<{
    conversations: ChatConversation[];
    contacts: ChatContact[];
  } | null>(null);
  const loadingRef = useRef(false);

  const refreshUnread = useCallback(() => {
    listChatConversations().then((rows) => {
      setUnread(rows.reduce((sum, c) => sum + c.unread_count, 0));
    });
  }, []);

  // 배지 초기값.
  useEffect(() => {
    refreshUnread();
  }, [refreshUnread]);

  // 개인 알림 채널 — 앱에 접속해 있는 동안 항상 열려 있다.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`user:${selfId}`, {
      config: { broadcast: { self: false, ack: false }, private: true },
    });
    channel
      .on("broadcast", { event: "chat-message" }, ({ payload }) => {
        const p = payload as FanoutPayload | null;
        if (!p?.conversation_id || !p.message_id) return;
        emitMessageNotify(p.conversation_id);
        // 지금 그 대화를 보고 있으면 스레드가 실시간으로 받으므로 조용히.
        if (getActiveConversation() === p.conversation_id) return;
        setUnread((n) => n + 1);
        setToasts((prev) =>
          [
            {
              id: p.message_id!,
              conversationId: p.conversation_id!,
              senderName: p.sender_name ?? "New message",
              senderAvatarUrl: p.sender_avatar_url ?? null,
              preview: p.preview ?? "",
            },
            ...prev,
          ].slice(0, MAX_TOASTS)
        );
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [selfId]);

  // 토스트 자동 소멸.
  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setTimeout(() => setToasts((prev) => prev.slice(0, -1)), TOAST_TTL_MS);
    return () => clearTimeout(t);
  }, [toasts]);

  const ensureData = useCallback(() => {
    if (data || loadingRef.current) return;
    loadingRef.current = true;
    Promise.all([listChatConversations(), listChatContacts()]).then(
      ([conversations, contacts]) => {
        setData({ conversations, contacts });
        loadingRef.current = false;
      }
    );
  }, [data]);

  const openPanel = useCallback(() => {
    ensureData();
    setOpen(true);
    refreshUnread();
  }, [ensureData, refreshUnread]);

  const onToastClick = (t: Toast) => {
    setToasts((prev) => prev.filter((x) => x.id !== t.id));
    openPanel();
    // 패널이 처음 열리는 경우 ChatShell 마운트 후에 열어야 하므로 다음 틱에.
    setTimeout(() => requestOpenConversation(t.conversationId), 50);
  };

  // /chat 전체 페이지에서는 위젯 UI(트리거·패널·토스트)를 전부 숨긴다 —
  // 채팅 화면이 이미 열려 있어 중복이다. 훅(개인 topic 구독)은 그대로 살아
  // 있어 페이지 목록 갱신(emitMessageNotify)은 계속 동작한다.
  if (pathname === "/chat" || pathname.startsWith("/chat/")) return null;

  return (
    <>
      {/* ---------------------------------------------- 인스타풍 알림 토스트 */}
      <div className="chat-toasts" aria-live="polite">
        {toasts.map((t) => (
          <button key={t.id} className="chat-toast" onClick={() => onToastClick(t)}>
            <UserAvatar url={t.senderAvatarUrl} name={t.senderName} size={34} />
            <span className="chat-toast-body">
              <span className="chat-toast-sender">{t.senderName}</span>
              <span className="chat-toast-preview">{cleanPreview(t.preview) || "New message"}</span>
            </span>
            <span
              className="chat-toast-close"
              role="button"
              aria-label="Dismiss"
              onClick={(e) => {
                e.stopPropagation();
                setToasts((prev) => prev.filter((x) => x.id !== t.id));
              }}
            >
              ✕
            </span>
          </button>
        ))}
      </div>

      {/* --------------------------------- 우측 슬라이드 오버 채팅 패널 */}
      {open && (
        <div className={`chat-float-panel ${expanded ? "expanded" : ""}`}>
          <div className="chat-float-head">
            <span className="label">CHAT</span>
            <div className="row" style={{ gap: 2 }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setOpen(false);
                  openTab("chat", "comms", "Chat");
                }}
                title="Open as workspace tab (split view)"
                aria-label="Open chat as a workspace tab"
              >
                ⿻
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setExpanded((v) => !v)}
                title={expanded ? "Shrink" : "Expand"}
                aria-label={expanded ? "Shrink chat panel" : "Expand chat panel"}
              >
                {expanded ? "⤡" : "⤢"}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setOpen(false);
                  refreshUnread();
                }}
                title="Minimize"
                aria-label="Minimize chat panel"
              >
                —
              </button>
            </div>
          </div>
          {data ? (
            <ChatShell
              selfId={selfId}
              selfName={selfName}
              initialConversations={data.conversations}
              contacts={data.contacts}
              variant="float"
            />
          ) : (
            <div className="chat-empty" style={{ flex: 1 }}>
              Loading…
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------ 헤더 트리거(프로필 옆 아이콘) */}
      <button
        className={`chat-header-btn ${open ? "active" : ""}`}
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-label={`${open ? "Close" : "Open"} chat${unread > 0 ? ` (${unread} unread)` : ""}`}
        title="Chat"
      >
        Chat
        {unread > 0 && (
          <span className="chat-unread chat-bubble-badge">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
    </>
  );
}
