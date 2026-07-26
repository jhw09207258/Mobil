"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import "./sophia.css";
import {
  listConversations,
  createConversation,
  getMessages,
  deleteConversation,
  renameConversation,
  type ConversationRow,
  type MessageRow,
} from "./actions";
import { PluginBar } from "./plugin-bar";
import { Modal } from "@/components/modal";
import { ThinkingIndicator } from "@/components/thinking-indicator";
import { BIG_BROTHER_MODELS } from "@/lib/big-brother-gemini";

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
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  // 답을 기다리는 동안 경과 초 — 멈춘 것처럼 보이지 않게 한다.
  const [thinkSecs, setThinkSecs] = useState(0);
  const [model, setModel] = useState<string>(BIG_BROTHER_MODELS[0].id);

  useEffect(() => {
    if (!sending) {
      setThinkSecs(0);
      return;
    }
    const t0 = Date.now();
    const timer = setInterval(() => setThinkSecs(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [sending]);

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
    router.refresh();
  };

  const onDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this chat? This cannot be undone.")) return;
    const res = await deleteConversation(id);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    // 업데이터 안에서 다른 setState 를 부르면 안 된다(순수해야 한다) —
    // 다음 활성 대화는 여기서 미리 계산한다.
    const next = conversations.filter((c) => c.id !== id);
    setConversations(next);
    if (activeId === id) setActiveId(next[0]?.id ?? null);
    // 서버 컴포넌트의 initialConversations 를 갱신한다. 안 하면 이 컴포넌트가
    // 다시 마운트될 때(모드 전환 등) 지운 대화가 되살아난다.
    router.refresh();
  };

  const onRename = async (c: ConversationRow, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenaming({ id: c.id, title: c.title });
  };

  const submitRename = async () => {
    if (!renaming) return;
    const res = await renameConversation(renaming.id, renaming.title);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setConversations((prev) =>
      prev.map((c) => (c.id === renaming.id ? { ...c, title: res.title } : c))
    );
    setRenaming(null);
    router.refresh();
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
        body: JSON.stringify({ conversationId, content: text, model }),
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
                className="sophia-conv-action"
                onClick={(e) => onRename(c, e)}
                aria-label="Rename chat"
                title="Rename chat"
              >
                ✎
              </button>
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

      {renaming && (
        <Modal title="Rename chat" onClose={() => setRenaming(null)} width={420}>
          <input
            className="input"
            style={{ width: "100%" }}
            value={renaming.title}
            onChange={(e) => setRenaming({ ...renaming, title: e.target.value })}
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && submitRename()}
          />
          <div className="row" style={{ gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
            <button className="btn btn-sm" onClick={() => setRenaming(null)}>
              Cancel
            </button>
            <button
              className="btn btn-sm btn-primary"
              disabled={!renaming.title.trim()}
              onClick={submitRename}
            >
              Save
            </button>
          </div>
        </Modal>
      )}

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
                {m.pending && !m.content ? (
                  <ThinkingIndicator label="Big Brother is thinking" elapsed={thinkSecs} />
                ) : (
                  m.content
                )}
              </div>
            ))}
        </div>

        {/* 연결된 항목 — 어시스턴트가 검색 없이 바로 이걸 다룬다. */}
        <div className="sophia-meta-row">
          <PluginBar conversationId={activeId} />
          <select
            className="sophia-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={sending}
            title="Reasoning model"
          >
            {BIG_BROTHER_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

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
