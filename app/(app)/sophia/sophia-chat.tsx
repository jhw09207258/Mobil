"use client";

import { useEffect, useRef, useState } from "react";
import "./sophia.css";
import {
  listConversations,
  createConversation,
  getMessages,
  deleteConversation,
  type ConversationRow,
  type MessageRow,
} from "./actions";
import { PluginBar } from "./plugin-bar";

type LocalMessage = MessageRow & { pending?: boolean };

export function SophiaChat({
  initialConversations,
}: {
  initialConversations: ConversationRow[];
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState<string | null>(
    initialConversations[0]?.id ?? null
  );
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoadingMessages(true);
    getMessages(activeId).then((rows) => {
      if (cancelled) return;
      setMessages(rows);
      setLoadingMessages(false);
    });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const onNewChat = async () => {
    const res = await createConversation();
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setConversations((prev) => [res, ...prev]);
    setActiveId(res.id);
    setError(null);
  };

  const onDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this chat? This cannot be undone.")) return;
    const res = await deleteConversation(id);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (activeId === id) setActiveId(next[0]?.id ?? null);
      return next;
    });
  };

  const onSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    let conversationId = activeId;
    if (!conversationId) {
      const created = await createConversation();
      if ("error" in created) {
        setError(created.error);
        return;
      }
      conversationId = created.id;
      setConversations((prev) => [created, ...prev]);
      setActiveId(created.id);
    }

    setError(null);
    setInput("");
    setSending(true);

    const userMsgId = `pending-user-${Date.now()}`;
    const replyId = `pending-reply-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: text, created_at: new Date().toISOString() },
      { id: replyId, role: "assistant", content: "", created_at: new Date().toISOString(), pending: true },
    ]);

    try {
      const res = await fetch("/api/sophia/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, content: text }),
      });

      if (!res.ok || !res.body) {
        const message = await res.text().catch(() => "Big Brother is unavailable right now.");
        setError(message || "Big Brother is unavailable right now.");
        setMessages((prev) => prev.filter((m) => m.id !== userMsgId && m.id !== replyId));
        return;
      }

      // 스트림이 들어오는 대로 답변 버블에 실시간으로 이어붙인다.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;
        setMessages((prev) =>
          prev.map((m) => (m.id === replyId ? { ...m, content: m.content + chunk } : m))
        );
      }
      setMessages((prev) =>
        prev.map((m) => (m.id === replyId ? { ...m, pending: false } : m))
      );
    } catch {
      setError("Big Brother is unavailable right now.");
      setMessages((prev) => prev.filter((m) => m.id !== userMsgId && m.id !== replyId));
    } finally {
      setSending(false);
    }

    // 첫 메시지였다면 목록의 제목/정렬을 서버 기준으로 다시 맞춘다.
    listConversations().then(setConversations);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const activeTitle = conversations.find((c) => c.id === activeId)?.title;

  return (
    <div className="sophia-shell">
      <div className="sophia-list">
        <div className="sophia-list-head">
          <span className="label">CHATS</span>
          <button className="btn btn-sm btn-primary" onClick={onNewChat}>
            + New chat
          </button>
        </div>
        <div className="sophia-conv-list">
          {conversations.length === 0 && (
            <div className="empty" style={{ padding: 20 }}>
              No chats yet.
            </div>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`sophia-conv-item ${c.id === activeId ? "active" : ""}`}
              onClick={() => setActiveId(c.id)}
            >
              <span className="sophia-conv-title">{c.title}</span>
              <button
                className="sophia-conv-delete"
                onClick={(e) => onDelete(c.id, e)}
                aria-label="Delete chat"
                title="Delete chat"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="sophia-chat">
        {error && (
          <div style={{ padding: "10px 24px 0" }}>
            <div className="notice notice-error" style={{ margin: 0 }}>
              {error}
            </div>
          </div>
        )}

        <div className="sophia-messages" ref={scrollRef}>
          {!activeId && !loadingMessages && (
            <div className="sophia-empty">Start a new chat with Big Brother below.</div>
          )}
          {activeId && loadingMessages && (
            <div className="sophia-empty">Loading…</div>
          )}
          {activeId &&
            !loadingMessages &&
            messages.map((m) => (
              <div
                key={m.id}
                className={`sophia-msg ${m.role} ${m.pending ? "pending" : ""}`}
              >
                {m.pending && !m.content ? "…" : m.content}
              </div>
            ))}
        </div>

        {/* 연결된 항목 — 어시스턴트가 검색 없이 바로 이걸 다룬다. */}
        <PluginBar conversationId={activeId} />

        <div className="sophia-input-bar">
          <textarea
            className="sophia-textarea"
            placeholder={
              activeTitle
                ? `Message Big Brother…`
                : "Ask Big Brother anything — your workspace, papers, code… (Enter to send, Shift+Enter for a new line)"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={sending}
          />
          <button
            className="btn btn-primary"
            onClick={onSend}
            disabled={sending || !input.trim()}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
