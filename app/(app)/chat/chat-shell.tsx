"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/modal";
import { useWorkspace, type TabKind } from "../workspace/workspace-context";
import {
  addMembers,
  createGroup,
  getChatMembers,
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
  type ChatMemberInfo,
  type ChatMessage,
} from "./actions";
import {
  onMessageNotify,
  onOpenConversation,
  setActiveConversation,
} from "./chat-bus";
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

// 타이핑 표시가 마지막 신호 후 이 시간(ms) 지나면 사라진다.
const TYPING_TTL_MS = 3500;
// 타이핑 신호 재전송 간격(ms) — 입력 중 이 간격으로만 브로드캐스트.
const TYPING_SEND_EVERY_MS = 2000;

// ---------------------------------------------------------------------------

export function ChatShell({
  selfId,
  selfName,
  initialConversations,
  contacts,
  variant = "page",
}: {
  selfId: string;
  selfName: string;
  initialConversations: ChatConversation[];
  contacts: ChatContact[];
  /** "page" = /chat 전체 화면(목록+스레드 나란히), "float" = 플로팅 위젯
   * (목록 ↔ 스레드를 한 칸에서 전환, 뒤로 가기 버튼). */
  variant?: "page" | "float";
}) {
  const { openTab } = useWorkspace();
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState<string | null>(
    variant === "float" ? null : (initialConversations[0]?.id ?? null)
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [members, setMembers] = useState<ChatMemberInfo[]>([]);
  const [typing, setTyping] = useState<Record<string, { name: string; at: number }>>({});
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
  const lastTypingSentRef = useRef(0);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  const refreshList = useCallback(() => {
    listChatConversations().then(setConversations);
  }, []);

  // 읽음을 서버에 기록하고, 같은 대화의 다른 멤버에게도 즉시 알린다.
  const announceRead = useCallback(
    (conversationId: string) => {
      markChatRead(conversationId).then(() => {
        setConversations((prev) =>
          prev.map((c) => (c.id === conversationId ? { ...c, unread_count: 0 } : c))
        );
        channelRef.current?.send({
          type: "broadcast",
          event: "read",
          payload: { user_id: selfId, at: new Date().toISOString() },
        });
      });
    },
    [selfId]
  );

  // 대화 전환: 메시지+멤버 로딩, 읽음 표시, 실시간 채널 구독(멤버 전용 private).
  useEffect(() => {
    setActiveConversation(activeId);
    if (!activeId) {
      setMessages([]);
      setMembers([]);
      setTyping({});
      return () => setActiveConversation(null);
    }
    let cancelled = false;
    setLoading(true);
    setTyping({});
    getChatMessages(activeId).then((rows) => {
      if (cancelled) return;
      setMessages(rows);
      setLoading(false);
    });
    getChatMembers(activeId).then((rows) => {
      if (!cancelled) setMembers(rows);
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
        setTyping((prev) => {
          if (!prev[msg.sender_id]) return prev;
          const next = { ...prev };
          delete next[msg.sender_id];
          return next;
        });
        announceRead(activeId);
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
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const p = payload as { user_id?: string; name?: string } | null;
        if (!p?.user_id || p.user_id === selfId) return;
        setTyping((prev) => ({ ...prev, [p.user_id!]: { name: p.name ?? "Someone", at: Date.now() } }));
      })
      .on("broadcast", { event: "read" }, ({ payload }) => {
        const p = payload as { user_id?: string; at?: string } | null;
        if (!p?.user_id || !p.at) return;
        setMembers((prev) =>
          prev.map((m) => (m.user_id === p.user_id ? { ...m, last_read_at: p.at! } : m))
        );
      })
      .subscribe((status) => {
        // 구독이 실제로 열린 뒤에 읽음을 알린다 — 그 전에 send 하면 유실된다.
        if (status === "SUBSCRIBED") announceRead(activeId);
      });
    channelRef.current = channel;

    return () => {
      cancelled = true;
      channelRef.current = null;
      supabase.removeChannel(channel);
      setActiveConversation(null);
    };
  }, [activeId, selfId, announceRead]);

  // 만료된 타이핑 표시 제거(1초 틱, 표시 중일 때만).
  useEffect(() => {
    if (Object.keys(typing).length === 0) return;
    const t = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        const next = Object.fromEntries(
          Object.entries(prev).filter(([, v]) => now - v.at < TYPING_TTL_MS)
        );
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [typing]);

  // 전역 알림(개인 topic fanout) → 목록 갱신. 토스트 클릭 → 해당 대화 열기.
  useEffect(() => {
    const offNotify = onMessageNotify(() => refreshList());
    const offOpen = onOpenConversation((id) => {
      setActiveId(id);
      setError(null);
    });
    return () => {
      offNotify();
      offOpen();
    };
  }, [refreshList]);

  // ponytail: 폴링은 fanout 알림이 못 미치는 경우(오프라인 복귀 등)의 안전망 —
  // 간격을 길게 잡는다.
  useEffect(() => {
    const t = setInterval(refreshList, 60_000);
    return () => clearInterval(t);
  }, [refreshList]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, typing]);

  const onInputChange = (value: string) => {
    setInput(value);
    const now = Date.now();
    if (value.trim() && now - lastTypingSentRef.current > TYPING_SEND_EVERY_MS) {
      lastTypingSentRef.current = now;
      channelRef.current?.send({
        type: "broadcast",
        event: "typing",
        payload: { user_id: selfId, name: selfName },
      });
    }
  };

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
      setActiveId(variant === "float" ? null : (next[0]?.id ?? null));
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

  // 읽음 표시 — 내가 보낸 "마지막" 메시지 하나에만 붙인다(Insta/카톡 스타일).
  const lastMine = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender_id === selfId) return messages[i];
    }
    return null;
  }, [messages, selfId]);

  const readReceipt = useMemo(() => {
    if (!lastMine) return null;
    const others = members.filter((m) => m.user_id !== selfId);
    if (others.length === 0) return null;
    const readers = others.filter((m) => m.last_read_at >= lastMine.created_at);
    if (readers.length === 0) return "Sent";
    if (readers.length === others.length) return "Read";
    return `Read by ${readers.length}/${others.length}`;
  }, [lastMine, members, selfId]);

  const typingNames = Object.values(typing).map((t) => t.name);

  const showList = variant === "page" || !activeId;
  const showThread = variant === "page" || !!activeId;

  return (
    <div className={`chat-shell ${variant === "float" ? "float" : ""}`}>
      {/* ------------------------------------------------ conversation list */}
      {showList && (
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
      )}

      {/* ------------------------------------------------------------ thread */}
      {showThread && (
        <div className="chat-thread">
          {active && (
            <div className="chat-thread-head">
              <div className="row" style={{ minWidth: 0 }}>
                {variant === "float" && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setActiveId(null)}
                    aria-label="Back to conversations"
                    title="Back"
                  >
                    ←
                  </button>
                )}
                <div className="chat-thread-title">
                  <span className="h-title">{active.title}</span>
                  <span className="chat-thread-meta">
                    {active.kind === "group"
                      ? `GROUP · ${active.member_count} MEMBERS`
                      : "DIRECT MESSAGE"}
                  </span>
                </div>
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
              <div className="chat-empty">Select a conversation, or start a new one.</div>
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
                    {mine && readReceipt && lastMine?.id === m.id && (
                      <span className={`chat-receipt ${readReceipt.startsWith("Read") ? "read" : ""}`}>
                        {readReceipt}
                      </span>
                    )}
                  </div>
                );
              })}
            {activeId && !loading && messages.length === 0 && (
              <div className="chat-empty">No messages yet — say hello.</div>
            )}
            {activeId && typingNames.length > 0 && (
              <div className="chat-typing">
                <span className="chat-typing-dots">
                  <i /><i /><i />
                </span>
                {typingNames.length === 1
                  ? `${typingNames[0]} is typing…`
                  : `${typingNames.slice(0, 2).join(", ")}${typingNames.length > 2 ? ` +${typingNames.length - 2}` : ""} are typing…`}
              </div>
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
                onChange={(e) => onInputChange(e.target.value)}
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
      )}

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
