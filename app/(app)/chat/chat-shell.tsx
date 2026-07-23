"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/modal";
import { useWorkspace, type TabKind } from "../workspace/workspace-context";
import {
  addMembers,
  createGroup,
  getChatMessages,
  leaveConversation,
  listAttachableItems,
  listChatConversations,
  markChatRead,
  sendChatMessage,
  startDm,
  type AttachableItem,
  type ChatContact,
  type ChatConversation,
  type ChatMessage,
} from "./actions";
import "./chat.css";

// ---------------------------------------------------------------------------
// 메시지 본문 파싱 — 첨부 토큰([[kind:uuid|Title]])과 내부 경로
// (/documents/<uuid> 등)를 워크스페이스 탭으로 열리는 칩으로 렌더링한다.
// ---------------------------------------------------------------------------
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SEGMENT_RE = new RegExp(
  `\\[\\[(document|code|sheet|mindmap):(${UUID})\\|([^\\]]{1,160})\\]\\]` +
    `|(?:https?://[^\\s]*)?/(documents|code|sheets|mindmap)/(${UUID})`,
  "gi"
);
const ROUTE_TO_KIND: Record<string, TabKind> = {
  documents: "document",
  code: "code",
  sheets: "sheet",
  mindmap: "mindmap",
};

type Segment =
  | { type: "text"; text: string }
  | { type: "ref"; kind: TabKind; id: string; title: string };

function parseSegments(content: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of content.matchAll(SEGMENT_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ type: "text", text: content.slice(last, idx) });
    if (m[1]) {
      out.push({ type: "ref", kind: m[1].toLowerCase() as TabKind, id: m[2].toLowerCase(), title: m[3] });
    } else {
      const kind = ROUTE_TO_KIND[m[4].toLowerCase()];
      out.push({ type: "ref", kind, id: m[5].toLowerCase(), title: kind });
    }
    last = idx + m[0].length;
  }
  if (last < content.length) out.push({ type: "text", text: content.slice(last) });
  return out;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" }) +
        " " +
        d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function contactName(c: ChatContact): string {
  return c.display_name || c.email.split("@")[0];
}

// ---------------------------------------------------------------------------

export function ChatShell({
  selfId,
  initialConversations,
  contacts,
}: {
  selfId: string;
  initialConversations: ChatConversation[];
  contacts: ChatContact[];
}) {
  const { openTab } = useWorkspace();
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState<string | null>(
    initialConversations[0]?.id ?? null
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"new" | "add-members" | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachables, setAttachables] = useState<AttachableItem[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  const refreshList = useCallback(() => {
    listChatConversations().then(setConversations);
  }, []);

  // 대화 전환: 메시지 로딩 + 읽음 표시 + 실시간 채널 구독(멤버 전용 private).
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getChatMessages(activeId).then((rows) => {
      if (cancelled) return;
      setMessages(rows);
      setLoading(false);
    });
    markChatRead(activeId).then(() => {
      setConversations((prev) =>
        prev.map((c) => (c.id === activeId ? { ...c, unread_count: 0 } : c))
      );
    });

    const supabase = createClient();
    const channel = supabase.channel(`chat:${activeId}`, {
      config: { broadcast: { self: false, ack: false }, private: true },
    });
    channel
      .on("broadcast", { event: "message" }, ({ payload }) => {
        const msg = payload as ChatMessage | null;
        if (!msg?.id) return;
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        markChatRead(activeId);
        setConversations((prev) =>
          prev
            .map((c) =>
              c.id === activeId
                ? { ...c, last_message: msg.content, last_message_at: msg.created_at, updated_at: msg.created_at }
                : c
            )
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        );
      })
      .subscribe();
    channelRef.current = channel;

    return () => {
      cancelled = true;
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [activeId]);

  // ponytail: 비활성 대화의 안 읽음 배지는 25초 폴링으로 갱신 — 사용자별 전역
  // broadcast 토픽(user:<id>)으로 푸시하는 게 다음 단계 업그레이드다.
  useEffect(() => {
    const t = setInterval(refreshList, 25_000);
    return () => clearInterval(t);
  }, [refreshList]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const onSend = async () => {
    const text = input.trim();
    if (!text || sending || !activeId) return;
    setSending(true);
    setError(null);
    const res = await sendChatMessage(activeId, text);
    setSending(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setInput("");
    setMessages((prev) => [...prev, res]);
    channelRef.current?.send({ type: "broadcast", event: "message", payload: res });
    setConversations((prev) =>
      prev
        .map((c) =>
          c.id === activeId
            ? { ...c, last_message: res.content, last_message_at: res.created_at, updated_at: res.created_at }
            : c
        )
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    );
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const openConversation = (id: string) => {
    setActiveId(id);
    setError(null);
  };

  const onStarted = (id: string) => {
    setDialog(null);
    refreshList();
    setActiveId(id);
  };

  const onLeave = async () => {
    if (!activeId || !active) return;
    if (!confirm(`Leave “${active.title}”?`)) return;
    const res = await leaveConversation(activeId);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== activeId);
      setActiveId(next[0]?.id ?? null);
      return next;
    });
  };

  const toggleAttach = () => {
    setAttachOpen((v) => !v);
    if (!attachables) listAttachableItems().then(setAttachables);
  };

  const insertAttachment = (item: AttachableItem) => {
    setAttachOpen(false);
    setInput((v) => `${v}${v && !v.endsWith(" ") ? " " : ""}[[${item.kind}:${item.id}|${item.title.replaceAll("]", "")}]] `);
    inputRef.current?.focus();
  };

  const openRef = (seg: { kind: TabKind; id: string; title: string }) => {
    openTab(seg.kind, seg.id, seg.title === seg.kind ? "Loading…" : seg.title);
  };

  return (
    <div className="chat-shell">
      {/* ------------------------------------------------ conversation list */}
      <div className="chat-list">
        <div className="chat-list-head">
          <span className="label">CONVERSATIONS</span>
          <button className="btn btn-sm btn-primary" onClick={() => setDialog("new")}>
            + New
          </button>
        </div>
        <div className="chat-conv-list">
          {conversations.length === 0 && (
            <div className="empty" style={{ padding: 20 }}>
              No conversations yet — start one with a co-worker.
            </div>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`chat-conv-item ${c.id === activeId ? "active" : ""}`}
              onClick={() => openConversation(c.id)}
            >
              <div className="chat-conv-avatar">
                {c.kind === "group" ? "⌗" : c.title.charAt(0).toUpperCase()}
              </div>
              <div className="chat-conv-body">
                <div className="chat-conv-top">
                  <span className="chat-conv-title">{c.title}</span>
                  {c.last_message_at && (
                    <span className="chat-conv-time">{fmtTime(c.last_message_at)}</span>
                  )}
                </div>
                <div className="chat-conv-bottom">
                  <span className="chat-conv-preview">
                    {c.last_message
                      ? c.last_message.replace(SEGMENT_RE, "⛓ attachment")
                      : c.kind === "group"
                        ? `${c.member_count} members`
                        : "No messages yet"}
                  </span>
                  {c.unread_count > 0 && (
                    <span className="chat-unread">{c.unread_count > 99 ? "99+" : c.unread_count}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------------ thread */}
      <div className="chat-thread">
        {active && (
          <div className="chat-thread-head">
            <div className="chat-thread-title">
              <span className="h-title">{active.title}</span>
              <span className="chat-thread-meta">
                {active.kind === "group"
                  ? `GROUP · ${active.member_count} MEMBERS`
                  : "DIRECT MESSAGE"}
              </span>
            </div>
            {active.kind === "group" && (
              <div className="row">
                <button className="btn btn-sm" onClick={() => setDialog("add-members")}>
                  Add members
                </button>
                <button className="btn btn-sm btn-danger" onClick={onLeave}>
                  Leave
                </button>
              </div>
            )}
          </div>
        )}

        {error && (
          <div style={{ padding: "10px 20px 0" }}>
            <div className="notice notice-error" style={{ margin: 0 }}>
              {error}
            </div>
          </div>
        )}

        <div className="chat-messages" ref={scrollRef}>
          {!activeId && (
            <div className="chat-empty">
              Select a conversation, or start a new one.
            </div>
          )}
          {activeId && loading && <div className="chat-empty">Loading…</div>}
          {activeId &&
            !loading &&
            messages.map((m, i) => {
              const mine = m.sender_id === selfId;
              const prev = messages[i - 1];
              const showHead =
                !prev ||
                prev.sender_id !== m.sender_id ||
                new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > 5 * 60_000;
              return (
                <div key={m.id} className={`chat-msg-row ${mine ? "mine" : ""}`}>
                  {showHead && (
                    <div className="chat-msg-head">
                      {!mine && <span className="chat-msg-sender">{m.sender_name}</span>}
                      <span className="chat-msg-time">{fmtTime(m.created_at)}</span>
                    </div>
                  )}
                  <div className={`chat-msg ${mine ? "mine" : "theirs"}`}>
                    {parseSegments(m.content).map((seg, j) =>
                      seg.type === "text" ? (
                        <span key={j}>{seg.text}</span>
                      ) : (
                        <button
                          key={j}
                          className="chat-ref-chip"
                          onClick={() => openRef(seg)}
                          title={`Open ${seg.kind} in workspace`}
                        >
                          <span className="chat-ref-kind">{seg.kind}</span>
                          {seg.title === seg.kind ? "open ↗" : seg.title}
                        </button>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          {activeId && !loading && messages.length === 0 && (
            <div className="chat-empty">No messages yet — say hello.</div>
          )}
        </div>

        {activeId && (
          <div className="chat-input-bar">
            <div className="chat-attach">
              <button
                className="btn"
                onClick={toggleAttach}
                title="Attach a workspace item"
                aria-label="Attach a workspace item"
              >
                ⛓
              </button>
              {attachOpen && (
                <div className="chat-attach-menu">
                  <div className="chat-attach-head label">ATTACH WORKSPACE ITEM</div>
                  {!attachables && <div className="chat-empty" style={{ padding: 14 }}>Loading…</div>}
                  {attachables?.length === 0 && (
                    <div className="chat-empty" style={{ padding: 14 }}>Nothing to attach yet.</div>
                  )}
                  {attachables?.map((item) => (
                    <button
                      key={`${item.kind}:${item.id}`}
                      className="chat-attach-item"
                      onClick={() => insertAttachment(item)}
                    >
                      <span className="chat-ref-kind">{item.kind}</span>
                      <span className="chat-attach-title">{item.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <textarea
              ref={inputRef}
              className="chat-textarea"
              placeholder="Message… (Enter to send, Shift+Enter for a new line)"
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
        )}
      </div>

      {dialog === "new" && (
        <NewChatDialog contacts={contacts} onClose={() => setDialog(null)} onStarted={onStarted} />
      )}
      {dialog === "add-members" && activeId && (
        <AddMembersDialog
          conversationId={activeId}
          contacts={contacts}
          onClose={() => setDialog(null)}
          onAdded={() => {
            setDialog(null);
            refreshList();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 새 대화 다이얼로그 — DM(연락처 클릭) / 그룹(이름 + 멤버 다중 선택)
// ---------------------------------------------------------------------------
function NewChatDialog({
  contacts,
  onClose,
  onStarted,
}: {
  contacts: ChatContact[];
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const [mode, setMode] = useState<"dm" | "group">("dm");
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        (c.display_name ?? "").toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
    );
  }, [contacts, query]);

  const onPickDm = async (c: ChatContact) => {
    if (busy) return;
    setBusy(true);
    const res = await startDm(c.id);
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    onStarted(res.id);
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onCreateGroup = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await createGroup(title, [...selected]);
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    onStarted(res.id);
  };

  return (
    <Modal title="New conversation" onClose={onClose}>
      <div className="chat-mode-tabs">
        <button
          className={`category-tab ${mode === "dm" ? "active" : ""}`}
          onClick={() => setMode("dm")}
        >
          Direct message
        </button>
        <button
          className={`category-tab ${mode === "group" ? "active" : ""}`}
          onClick={() => setMode("group")}
        >
          Group
        </button>
      </div>

      {error && (
        <div className="notice notice-error" style={{ marginBottom: 10 }}>
          {error}
        </div>
      )}

      {mode === "group" && (
        <input
          className="input"
          style={{ marginBottom: 10 }}
          placeholder="Group name"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
        />
      )}

      <input
        className="input"
        style={{ marginBottom: 10 }}
        placeholder="Search people…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="chat-contact-list">
        {filtered.length === 0 && <div className="empty">No one found.</div>}
        {filtered.map((c) => (
          <button
            key={c.id}
            className={`chat-contact ${mode === "group" && selected.has(c.id) ? "selected" : ""}`}
            onClick={() => (mode === "dm" ? onPickDm(c) : toggle(c.id))}
            disabled={busy}
          >
            <span className="chat-conv-avatar">{contactName(c).charAt(0).toUpperCase()}</span>
            <span className="chat-contact-body">
              <span className="chat-contact-name">{contactName(c)}</span>
              <span className="chat-contact-email">{c.email}</span>
            </span>
            {mode === "group" && (
              <span className="chat-contact-check">{selected.has(c.id) ? "☑" : "☐"}</span>
            )}
          </button>
        ))}
      </div>

      {mode === "group" && (
        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 12 }}
          onClick={onCreateGroup}
          disabled={busy || !title.trim() || selected.size === 0}
        >
          {busy ? "Creating…" : `Create group (${selected.size} selected)`}
        </button>
      )}
    </Modal>
  );
}

function AddMembersDialog({
  conversationId,
  contacts,
  onClose,
  onAdded,
}: {
  conversationId: string;
  contacts: ChatContact[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onSubmit = async () => {
    setBusy(true);
    setError(null);
    const res = await addMembers(conversationId, [...selected]);
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    onAdded();
  };

  return (
    <Modal title="Add members" onClose={onClose}>
      {error && (
        <div className="notice notice-error" style={{ marginBottom: 10 }}>
          {error}
        </div>
      )}
      <div className="chat-contact-list">
        {contacts.map((c) => (
          <button
            key={c.id}
            className={`chat-contact ${selected.has(c.id) ? "selected" : ""}`}
            onClick={() => toggle(c.id)}
            disabled={busy}
          >
            <span className="chat-conv-avatar">{contactName(c).charAt(0).toUpperCase()}</span>
            <span className="chat-contact-body">
              <span className="chat-contact-name">{contactName(c)}</span>
              <span className="chat-contact-email">{c.email}</span>
            </span>
            <span className="chat-contact-check">{selected.has(c.id) ? "☑" : "☐"}</span>
          </button>
        ))}
      </div>
      <button
        className="btn btn-primary btn-block"
        style={{ marginTop: 12 }}
        onClick={onSubmit}
        disabled={busy || selected.size === 0}
      >
        {busy ? "Adding…" : `Add ${selected.size} member${selected.size === 1 ? "" : "s"}`}
      </button>
    </Modal>
  );
}
