"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/modal";
import { UserAvatar } from "@/components/user-avatar";
import { useIsMobile } from "@/lib/use-media-query";
import {
  IconPlus, IconClip, IconSmile, IconLink, IconImage, IconChat, IconSend,
  IconReply, IconEdit, IconTrash, IconMore, IconClose, IconGroup,
  IconCheckSquare, IconChevronLeft, IconIndent,
} from "../icons";
import { useWorkspace, type TabKind } from "../workspace/workspace-context";
import { ThinkingIndicator } from "@/components/thinking-indicator";
import {
  addMembers,
  createGroup,
  deleteChatMessage,
  editChatMessage,
  getChatMembers,
  getBigBrotherEnabled,
  setBigBrother,
  getChatMessages,
  leaveConversation,
  listChatConversations,
  markChatRead,
  sendChatMessage,
  startDm,
  toggleReaction,
  type ChatContact,
  type ChatConversation,
  type ChatMemberInfo,
  type ChatMessage,
  type ChatReaction,
} from "./actions";
import {
  onMessageNotify,
  onOpenConversation,
  setActiveConversation,
} from "./chat-bus";
import {
  extractRefs,
  parseMessage,
  UUID_PATTERN,
  type InlineToken,
  type RefKind,
} from "./markdown-parse";
import {
  getObjectCards,
  getPreviewUrl,
  listAttachables,
  requestAccess,
  shareWithConversation,
  type AttachableObject,
  type ObjectCard,
} from "../sharing/actions";
import { FilePreview, type PreviewTarget } from "@/components/file-preview";
import { getSignedUrl } from "../files/actions";
import { triggerDownload } from "@/lib/download-file";
import { formatBytes } from "@/lib/format";
import "./chat.css";

// ---------------------------------------------------------------------------
// 메시지 본문 — 경량 마크다운(markdown-parse.ts) 블록/인라인 토큰을 렌더링.
// 첨부 토큰([[kind:uuid|Title]])/내부 경로는 워크스페이스 탭 칩으로.
// ---------------------------------------------------------------------------
type RefToken = { kind: RefKind; id: string; title: string };

/** 첨부 카드가 필요로 하는 것들 — 트리 깊숙이 prop 을 흘리지 않도록 Context 로. */
type RefCardApi = {
  cards: Map<string, ObjectCard>;
  selfId: string;
  onOpen: (ref: RefToken) => void;
  onShareHere: (ref: RefToken) => void;
  onRequest: (ref: RefToken) => void;
  busy: string | null;
};
const RefCardContext = createContext<RefCardApi | null>(null);

const KIND_LABEL: Record<RefKind, string> = {
  document: "Doc",
  code: "Code",
  sheet: "Table",
  mindmap: "Link Graph",
  file: "File",
  event: "Event",
};

function cardKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

/** 카드 부제 — 종류마다 그 자리에서 알고 싶은 것이 다르다. */
function cardSubtitle(kind: RefKind, card: ObjectCard | undefined): string | null {
  if (!card) return null;
  if (kind === "file") {
    const bits = [card.mime_type, card.size_bytes != null ? formatBytes(card.size_bytes) : null];
    return bits.filter(Boolean).join(" · ") || null;
  }
  if (kind === "event" && card.subtitle) {
    const when = new Date(card.subtitle);
    return Number.isNaN(when.getTime())
      ? null
      : when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }
  if (card.updated_at) {
    return `Updated ${new Date(card.updated_at).toLocaleDateString()}`;
  }
  return card.subtitle;
}

/**
 * 첨부 카드. 이름만 있는 칩이 아니라 "무엇인지 / 누구 것인지 / 열 수 있는지"
 * 를 보여 준다. 열 수 없으면 그 자리에서 요청까지 할 수 있고, 내가 소유자면
 * 그 자리에서 이 대화에 권한을 줄 수 있다.
 */
function RefCard({ token }: { token: RefToken }) {
  const api = useContext(RefCardContext);
  const card = api?.cards.get(cardKey(token.kind, token.id));
  const busy = api?.busy === cardKey(token.kind, token.id);
  const title = card?.title || (token.title === token.kind ? "Untitled" : token.title);

  // 메타데이터가 아직 안 왔으면 예전처럼 이름만 있는 칩으로 둔다 — 목록이
  // 로딩되는 동안 레이아웃이 크게 흔들리지 않게.
  if (!card) {
    return (
      <button className="chat-ref-chip" onClick={() => api?.onOpen(token)} title={`Open ${token.kind}`}>
        <span className="chat-ref-kind">{KIND_LABEL[token.kind] ?? token.kind}</span>
        {title}
      </button>
    );
  }

  if (!card.object_exists) {
    return (
      <span className="chat-ref-card gone">
        <span className="chat-ref-kind">{KIND_LABEL[token.kind] ?? token.kind}</span>
        <span className="chat-ref-body">
          <span className="chat-ref-title">No longer available</span>
          <span className="chat-ref-sub">It was deleted or moved to trash.</span>
        </span>
      </span>
    );
  }

  if (!card.can_view) {
    // 일정은 권한 테이블이 아니라 초대로 열린다 — "요청하기" 를 걸어 봐야
    // 줄 수 있는 것이 없으므로, 누구에게 말해야 하는지만 알려 준다.
    const canAsk = token.kind !== "event";
    return (
      <span className="chat-ref-card locked">
        <span className="chat-ref-kind">{KIND_LABEL[token.kind] ?? token.kind}</span>
        <span className="chat-ref-body">
          <span className="chat-ref-title">
            {canAsk ? "You don't have access" : "You're not invited to this event"}
          </span>
          <span className="chat-ref-sub">
            {canAsk ? "Owned by " : "Organised by "}
            {card.owner_name ?? "another member"}
          </span>
        </span>
        {canAsk && (
          <button
            className="btn btn-sm chat-ref-action"
            disabled={busy}
            onClick={() => api?.onRequest(token)}
          >
            {busy ? "Asking…" : "Request access"}
          </button>
        )}
      </span>
    );
  }

  const subtitle = cardSubtitle(token.kind, card);

  return (
    <span className="chat-ref-card">
      <span className="chat-ref-kind">{KIND_LABEL[token.kind] ?? token.kind}</span>
      <button className="chat-ref-body chat-ref-open" onClick={() => api?.onOpen(token)}>
        <span className="chat-ref-title">{title}</span>
        <span className="chat-ref-sub">
          {[card.owner_name, subtitle].filter(Boolean).join(" · ")}
        </span>
      </button>
      {/* 권한을 줄 수 있는 사람은 소유자뿐이다(0065). edit 공유를 받은 사람에게
          버튼을 보여 주면 눌러도 아무 일이 없다 — 아예 내보내지 않는다. */}
      {token.kind !== "event" && card.owner_id === api?.selfId && (
        <button
          className="btn btn-ghost btn-sm chat-ref-action"
          disabled={busy}
          title="Give everyone in this chat access"
          onClick={() => api?.onShareHere(token)}
        >
          {busy ? "…" : "Share here"}
        </button>
      )}
    </span>
  );
}

// 대화 목록 미리보기에서 첨부 토큰을 "[attachment]" 로 치환.
const PREVIEW_ATTACH_RE = new RegExp(
  `\\[\\[(?:document|code|sheet|mindmap|file|event):${UUID_PATTERN}\\|[^\\]]{1,160}\\]\\]` +
    `|(?:https?://[^\\s]*)?/(?:documents|code|sheets|mindmap|files|calendar)/${UUID_PATTERN}`,
  "gi"
);
function previewText(raw: string): string {
  return raw
    .replace(/!\[[^\]\n]*\]\(https?:\/\/[^\s)]+\)/g, "[photo]")
    .replace(PREVIEW_ATTACH_RE, "[attachment]")
    .replace(/```/g, "")
    .replace(/\n+/g, " ");
}

const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10MB

function InlineTokens({ tokens }: { tokens: InlineToken[] }) {
  return (
    <>
      {tokens.map((tok, i) => {
        switch (tok.t) {
          case "bold":
            return <strong key={i}>{tok.text}</strong>;
          case "italic":
            return <em key={i}>{tok.text}</em>;
          case "underline":
            return <u key={i}>{tok.text}</u>;
          case "strike":
            return <s key={i}>{tok.text}</s>;
          case "code":
            return (
              <code key={i} className="chat-inline-code">
                {tok.text}
              </code>
            );
          case "mention":
            return (
              <span key={i} className="chat-mention">
                {tok.text}
              </span>
            );
          case "link":
            return (
              <a key={i} href={tok.href} target="_blank" rel="noopener noreferrer">
                {tok.text}
              </a>
            );
          case "image":
            return (
              <a key={i} href={tok.src} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="chat-img" src={tok.src} alt={tok.alt} loading="lazy" />
              </a>
            );
          case "ref":
            return <RefCard key={i} token={tok as RefToken} />;
          default:
            return <span key={i}>{tok.text}</span>;
        }
      })}
    </>
  );
}

function MessageBody({ content }: { content: string }) {
  const blocks = useMemo(() => parseMessage(content), [content]);
  return (
    <>
      {blocks.map((b, i) => {
        if (b.t === "codeblock") {
          return (
            <pre key={i} className="chat-codeblock">
              {b.text}
            </pre>
          );
        }
        if (b.t === "list") {
          return (
            <div key={i} className="chat-list-block">
              {b.items.map((item, j) => (
                <div key={j} className="chat-li" style={{ paddingLeft: item.indent * 14 }}>
                  <span className="chat-li-marker">
                    {item.marker === "-" || item.marker === "*" ? "•" : item.marker}
                  </span>
                  <span className="chat-li-body">
                    <InlineTokens tokens={item.tokens} />
                  </span>
                </div>
              ))}
            </div>
          );
        }
        return (
          <div key={i} className="chat-para">
            {b.lines.map((line, j) => (
              <div key={j} className="chat-para-line">
                {line.length === 0 ? " " : <InlineTokens tokens={line} />}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

// 긴 메시지는 접어두고 "Show more" 로 펼친다.
const COLLAPSE_CHARS = 700;
const COLLAPSE_LINES = 12;

function CollapsibleBody({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong =
    content.length > COLLAPSE_CHARS || content.split("\n").length > COLLAPSE_LINES;
  if (!isLong) return <MessageBody content={content} />;
  return (
    <>
      <div className={`chat-msg-clip ${expanded ? "" : "clipped"}`}>
        <MessageBody content={content} />
      </div>
      <button className="chat-expand-btn" onClick={() => setExpanded((v) => !v)}>
        {expanded ? "Show less ▲" : "Show more ▼"}
      </button>
    </>
  );
}

// 자주 쓰는 이모지 — 시스템 이모지 입력기의 빠른 대체재.
const EMOJIS = [
  "😀", "😂", "😊", "😍", "🤔", "😮", "😢", "😴",
  "👍", "👎", "🙏", "🤝", "👀", "💪", "🔥", "❤️",
  "🎉", "💯", "🚀", "✅", "❌", "⭐", "💡", "📌",
];

// 메시지 공감(빠른 반응) — 전체 이모지 중 가장 자주 쓰는 것만 추린 소집합.
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

// 다른 멤버의 공감 브로드캐스트를 받아 로컬 reactions 배열에 반영한다.
function applyReactionUpdate(
  reactions: ChatReaction[] | undefined,
  emoji: string,
  active: boolean,
  isSelf: boolean
): ChatReaction[] {
  const list = reactions ? [...reactions] : [];
  const i = list.findIndex((r) => r.emoji === emoji);
  if (active) {
    if (i === -1) {
      list.push({ emoji, count: 1, reacted_by_me: isSelf });
    } else {
      list[i] = { ...list[i], count: list[i].count + 1, reacted_by_me: list[i].reacted_by_me || isSelf };
    }
  } else if (i !== -1) {
    const count = list[i].count - 1;
    if (count <= 0) list.splice(i, 1);
    else list[i] = { ...list[i], count, reacted_by_me: isSelf ? false : list[i].reacted_by_me };
  }
  return list;
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

/** @bigbrother 호출 감지. 단어 경계를 둬서 이메일 등에 섞인 경우를 피한다. */
const MENTION_RE = /(^|[^\w@])@big\s?brother\b/i;

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
  const router = useRouter();
  const isMobile = useIsMobile();
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState<string | null>(
    variant === "float" ? null : (initialConversations[0]?.id ?? null)
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [members, setMembers] = useState<ChatMemberInfo[]>([]);
  // Big Brother 는 @bigbrother 로 부를 때만 답한다 — 상시 감시가 아니다.
  const [bbEnabled, setBbEnabled] = useState(false);
  const [bbThinking, setBbThinking] = useState(false);
  const [chatMoreOpen, setChatMoreOpen] = useState(false);
  const chatMoreRef = useRef<HTMLDivElement>(null);
  const [typing, setTyping] = useState<Record<string, { name: string; at: number }>>({});
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  // 링크 삽입 모달 — null 이면 닫힘, 문자열이면 열림(값은 입력 중 URL).
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"new" | "add-members" | null>(null);
  const [fmtOpen, setFmtOpen] = useState(false);
  // 컴포저 옵션은 전부 + 버튼 하나 뒤의 계층 메뉴로 모은다(공간 절약).
  const [menu, setMenu] = useState<"root" | "attach" | "emoji" | "mention" | null>(null);
  const [attachables, setAttachables] = useState<AttachableObject[] | null>(null);
  const [attachQuery, setAttachQuery] = useState("");
  // 첨부 카드 메타데이터 — 화면에 보이는 메시지의 참조를 한 번에 모아 받는다.
  const [cards, setCards] = useState<Map<string, ObjectCard>>(() => new Map());
  // 이미 물어본 참조. 응답이 비어 있어도 다시 묻지 않기 위한 것(아래 주석 참고).
  const requestedCards = useRef<Set<string>>(new Set());
  const [cardBusy, setCardBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  // 성공 안내(권한이 나갔다 등) — 오류와 달리 잠깐만 띄운다.
  const [notice, setNotice] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // 답장 대상 — 컴포저 위 배너에 표시되고, 전송 시 reply_to_id 로 붙는다.
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  // 공감 빠른 선택 팝오버가 열려 있는 메시지 id.
  const [reactMenuFor, setReactMenuFor] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const plusRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const lastTypingSentRef = useRef(0);

  // + 메뉴: 바깥 클릭/Escape 로 닫기(이전 버전의 "메뉴가 안 닫히는" 버그 시정).
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (plusRef.current && !plusRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // 공감 빠른 선택 팝오버 — 바깥 클릭/Escape 로 닫기(+ 메뉴와 동일한 패턴).
  useEffect(() => {
    if (!reactMenuFor) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".chat-react-popover")) setReactMenuFor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setReactMenuFor(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [reactMenuFor]);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  // activeId 를 ref 로도 들고 있어, 오래 살아있는 콜백(전역 알림 버스)에서
  // 최신 값을 참조할 수 있게 한다.
  const activeIdRef = useRef<string | null>(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

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
    // 대화를 바꾸면 이전 대화에서 편집/링크 중이던 UI 상태를 정리한다.
    setEditingId(null);
    setEditText("");
    setLinkUrl(null);
    setMenu(null);
    setNotice(null);
    // 대화가 바뀌면 첨부 카드 캐시를 버린다 — 그 사이 권한이 바뀌었을 수 있고,
    // "권한 없음" 이 남아 있는 것이 다시 받아오는 비용보다 나쁘다.
    setCards(new Map());
    requestedCards.current = new Set();
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
    getBigBrotherEnabled(activeId).then((v) => {
      if (!cancelled) setBbEnabled(v);
    }, () => {});
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
          // 봇 메시지는 보낸 사람이 없다 — 타이핑 표시를 지울 대상도 없다.
          if (!msg.sender_id || !prev[msg.sender_id]) return prev;
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
      .on("broadcast", { event: "edit" }, ({ payload }) => {
        const p = payload as { id?: string; content?: string; edited_at?: string } | null;
        if (!p?.id) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === p.id ? { ...m, content: p.content ?? m.content, edited_at: p.edited_at ?? null } : m
          )
        );
      })
      .on("broadcast", { event: "delete" }, ({ payload }) => {
        const p = payload as { id?: string } | null;
        if (!p?.id) return;
        setMessages((prev) => prev.filter((m) => m.id !== p.id));
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
      .on("broadcast", { event: "reaction" }, ({ payload }) => {
        const p = payload as { message_id?: string; emoji?: string; active?: boolean; user_id?: string } | null;
        if (!p?.message_id || !p.emoji) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === p.message_id
              ? { ...m, reactions: applyReactionUpdate(m.reactions, p.emoji!, !!p.active, p.user_id === selfId) }
              : m
          )
        );
      })
      // 누군가 이 대화에 자료 권한을 줬다 — 그 카드만 다시 읽어 잠금을 푼다.
      .on("broadcast", { event: "access" }, ({ payload }) => {
        const p = payload as { kind?: RefKind; id?: string } | null;
        if (!p?.kind || !p.id) return;
        const key = cardKey(p.kind, p.id);
        requestedCards.current.delete(key);
        getObjectCards([{ kind: p.kind, id: p.id }]).then(
          (rows) => {
            if (rows.length === 0) return;
            requestedCards.current.add(key);
            setCards((prev) => new Map(prev).set(key, rows[0]));
          },
          () => {}
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

  // 열려 있는 대화의 메시지를 4초마다 다시 불러오는 보장 동기화(폴링).
  // 실시간 브로드캐스트(chat:<id>)나 개인 fanout(user:<id>)이 구독 타이밍·
  // 토큰 지연·네트워크로 유실돼도, 이 폴링이 있으면 헤더 미니 채팅을 포함해
  // 모든 곳에서 대화 내용이 확실히 맞춰진다. 변화가 없으면 상태를 갱신하지
  // 않아 리렌더/스크롤 튐이 없다.
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    const poll = async () => {
      const rows = await getChatMessages(activeId);
      if (cancelled) return;
      setMessages((prev) => {
        const a = prev[prev.length - 1];
        const b = rows[rows.length - 1];
        if (prev.length === rows.length && a?.id === b?.id && a?.content === b?.content && a?.edited_at === b?.edited_at) {
          return prev; // 변화 없음
        }
        return rows;
      });
    };
    const t = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [activeId]);

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

  // 전역 알림(개인 topic fanout, DB 트리거가 확실히 보냄) → 목록 갱신 +
  // "열려 있는 대화"라면 메시지를 다시 불러온다. 클라이언트 브로드캐스트
  // (chat:<id>)가 구독 타이밍/네트워크로 유실돼도 이 경로로 확실히 동기화된다
  // — 미니(플로팅) 채팅이 안 맞던 문제의 근본 시정.
  useEffect(() => {
    const offNotify = onMessageNotify((conversationId) => {
      refreshList();
      if (conversationId === activeIdRef.current) {
        getChatMessages(conversationId).then((rows) => {
          // 최신 활성 대화가 그대로일 때만 반영(빠른 전환 시 경쟁 방지).
          if (conversationId === activeIdRef.current) setMessages(rows);
        });
        markChatRead(conversationId);
      }
    });
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

  // 새 메시지가 "추가"될 때(또는 대화 전환·타이핑 표시)만 맨 아래로 스크롤한다.
  // 기존 메시지 편집/삭제로 개수가 그대로거나 줄면 스크롤을 건드리지 않는다
  // (오래된 메시지를 편집할 때 화면이 아래로 튀는 것 방지).
  const prevMsgCountRef = useRef(0);
  useEffect(() => {
    if (messages.length >= prevMsgCountRef.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
    prevMsgCountRef.current = messages.length;
  }, [messages, typing, activeId]);

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

    // 첨부가 있으면 **먼저** 권한을 넘긴다. 링크만 던지고 "권한 없음" 을 보게
    // 하는 것이 지금까지의 문제였다 — 알림이 뜬 순간 이미 열려야 한다.
    // 실패해도 메시지는 보낸다(카드에서 요청할 수 있다).
    const refs = extractRefs([text]);
    let grantedTotal = 0;
    for (const ref of refs) {
      const outcome = await shareWithConversation(ref.kind, ref.id, activeId, "view");
      if (!("error" in outcome)) grantedTotal += outcome.granted;
    }

    const res = await sendChatMessage(activeId, text, replyTo?.id ?? null);
    setSending(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    if (grantedTotal > 0) {
      setNotice(
        `Access granted to ${grantedTotal} ${grantedTotal === 1 ? "person" : "people"} — they can open the attachment right away.`
      );
    }
    setInput("");
    setReplyTo(null);
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

    // @bigbrother 로 불렀을 때만 돈다. 답은 서버가 채팅 메시지로 남기고 기존
    // fanout 이 실시간으로 뿌리므로, 여기서 응답을 기다리지 않는다 —
    // 화면을 옮기거나 창을 닫아도 답이 도착한다.
    if (bbEnabled && MENTION_RE.test(text)) {
      setBbThinking(true);
      fetch("/api/sophia/chat-mention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: activeId }),
      })
        .catch(() => {})
        .finally(() => setBbThinking(false));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const startEdit = (m: ChatMessage) => {
    setEditingId(m.id);
    setEditText(m.content);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const text = editText.trim();
    if (!text) return;
    const res = await editChatMessage(editingId, text);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setMessages((prev) =>
      prev.map((m) => (m.id === editingId ? { ...m, content: text, edited_at: res.edited_at } : m))
    );
    channelRef.current?.send({
      type: "broadcast",
      event: "edit",
      payload: { id: editingId, content: text, edited_at: res.edited_at },
    });
    setEditingId(null);
    setEditText("");
    refreshList(); // 마지막 메시지를 고쳤으면 목록 미리보기도 갱신.
  };

  const onDeleteMessage = async (id: string) => {
    if (!confirm("Delete this message?")) return;
    const res = await deleteChatMessage(id);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setMessages((prev) => prev.filter((m) => m.id !== id));
    channelRef.current?.send({ type: "broadcast", event: "delete", payload: { id } });
    refreshList(); // 마지막 메시지를 지웠으면 목록 미리보기도 갱신.
  };

  // 공감 토글 — 낙관적으로 먼저 반영하고, 실패하면 되돌린다. 다른 멤버에게는
  // chat:<id> 브로드캐스트로 즉시 전파(메시지 편집/삭제와 같은 방식).
  const onToggleReaction = async (messageId: string, emoji: string) => {
    setReactMenuFor(null);
    const mine = messages.find((m) => m.id === messageId)?.reactions?.find((r) => r.emoji === emoji)?.reacted_by_me;
    const optimisticActive = !mine;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? { ...m, reactions: applyReactionUpdate(m.reactions, emoji, optimisticActive, true) }
          : m
      )
    );
    const res = await toggleReaction(messageId, emoji);
    if ("error" in res) {
      // 실패 — 낙관적 반영을 되돌린다.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, reactions: applyReactionUpdate(m.reactions, emoji, !optimisticActive, true) }
            : m
        )
      );
      setError(res.error);
      return;
    }
    channelRef.current?.send({
      type: "broadcast",
      event: "reaction",
      payload: { message_id: messageId, emoji, active: res.active, user_id: selfId },
    });
  };

  const openConversation = (id: string) => {
    setActiveId(id);
    setError(null);
    setMenu(null); // 대화 전환 시 열려 있던 메뉴가 남지 않게.
  };

  // 알림 메일의 링크(/chat?c=…)는 그 대화를 바로 연다. 서버 렌더에는 쿼리가
  // 반영되지 않으므로 마운트 뒤에 읽는다 — 초기값에서 읽으면 hydration 이
  // 어긋난다. 이미 나간 대화면 목록에 없으니 그대로 둔다.
  useEffect(() => {
    if (variant === "float") return;
    const wanted = new URLSearchParams(window.location.search).get("c");
    if (wanted && initialConversations.some((c) => c.id === wanted)) setActiveId(wanted);
    // 최초 진입에서만 — 이후 사용자가 고른 대화를 덮어쓰면 안 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onStarted = (id: string) => {
    setDialog(null);
    refreshList();
    setActiveId(id);
  };

  useEffect(() => {
    if (!chatMoreOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!chatMoreRef.current?.contains(e.target as Node)) setChatMoreOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [chatMoreOpen]);

  const onToggleBigBrother = async () => {
    if (!activeId) return;
    const next = !bbEnabled;
    setBbEnabled(next); // 낙관적 — 실패하면 되돌린다.
    const res = await setBigBrother(activeId, next);
    if ("error" in res) {
      setBbEnabled(!next);
      setError(res.error);
    }
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

  const openAttachMenu = () => {
    setMenu("attach");
    if (!attachables) listAttachables().then(setAttachables, () => setAttachables([]));
  };

  // 첨부 후보 검색 — 최근 40개 안에 없는 것을 찾을 수 있어야 한다. 타이핑마다
  // 서버를 때리지 않도록 짧게 미룬다.
  useEffect(() => {
    if (menu !== "attach") return;
    const q = attachQuery.trim();
    const timer = setTimeout(() => {
      listAttachables(q).then(setAttachables, () => {});
    }, q ? 220 : 0);
    return () => clearTimeout(timer);
  }, [attachQuery, menu]);

  // 안내는 잠깐만 — 오류와 달리 사용자가 치울 것을 요구하지 않는다.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  // ---- 첨부 카드 ----
  // 보이는 메시지들의 참조를 모아, 아직 물어보지 않은 것만 한 번에 조회한다.
  //
  // "아직 **물어보지** 않은" 이 중요하다. 서버가 어떤 참조에 대해 행을 돌려주지
  // 않으면(모르는 종류 등) 그 키는 cards 에 영영 안 들어가는데, 조건을 cards
  // 기준으로 잡으면 응답이 올 때마다 상태가 바뀌고 → 다시 없는 것을 묻고 →
  // 무한 반복이 된다. 요청한 키를 따로 기억해 한 번씩만 묻는다.
  useEffect(() => {
    const refs = extractRefs(messages.map((m) => m.content));
    const missing = refs.filter((r) => !requestedCards.current.has(cardKey(r.kind, r.id)));
    if (missing.length === 0) return;
    for (const r of missing) requestedCards.current.add(cardKey(r.kind, r.id));

    let cancelled = false;
    getObjectCards(missing).then(
      (rows) => {
        if (cancelled || rows.length === 0) return;
        setCards((prev) => {
          const next = new Map(prev);
          for (const row of rows) next.set(cardKey(row.kind, row.id), row);
          return next;
        });
      },
      () => {
        // 실패한 것은 다시 물어볼 수 있게 표시를 지운다.
        for (const r of missing) requestedCards.current.delete(cardKey(r.kind, r.id));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [messages]);

  const onShareRefHere = useCallback(
    async (ref: RefToken) => {
      if (!activeIdRef.current) return;
      const key = cardKey(ref.kind, ref.id);
      setCardBusy(key);
      setError(null);
      const res = await shareWithConversation(ref.kind, ref.id, activeIdRef.current, "view");
      setCardBusy(null);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      if (res.granted > 0) {
        // 받는 쪽 화면의 카드는 대화를 열 때 계산된 상태로 굳어 있다. 방금
        // 권한을 줬다는 사실을 알려 그 카드만 다시 읽게 한다 — 안 그러면
        // "줬다는데 여전히 잠겨 있다" 가 된다.
        channelRef.current?.send({
          type: "broadcast",
          event: "access",
          payload: { kind: ref.kind, id: ref.id },
        });
      }
      setNotice(
        !res.canGrant
          ? "Only the owner can grant access to this item."
          : res.granted > 0
            ? `${res.granted} ${res.granted === 1 ? "person" : "people"} in this chat can now open it.`
            : res.members === 0
              ? "No one else is in this conversation yet."
              : "Everyone here could already open it."
      );
    },
    []
  );

  const onRequestRefAccess = useCallback(
    async (ref: RefToken) => {
      const key = cardKey(ref.kind, ref.id);
      setCardBusy(key);
      setError(null);
      const res = await requestAccess(ref.kind, ref.id);
      setCardBusy(null);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setNotice(`Asked ${res.ownerName} for access — check your chat with them.`);
      refreshList();
    },
    [refreshList]
  );

  // 사진 전송 — 문서 에디터와 같은 공개 media 버킷({uid}/... 경로 정책)에
  // 올리고 이미지 토큰(![alt](url))으로 삽입한다.
  const uploadPhoto = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Only image files can be sent as photos.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError("Photo exceeds the 10MB limit.");
      return;
    }
    setError(null);
    setUploadingPhoto(true);
    try {
      const supabase = createClient();
      const id = crypto.randomUUID();
      const safe = file.name.replace(/[^\w.\- ]+/g, "_");
      const path = `${selfId}/chat/${id}/${safe}`;
      const { error: upErr } = await supabase.storage
        .from("media")
        .upload(path, file, { contentType: file.type || undefined });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("media").getPublicUrl(path);
      insertAtCursor(`![${safe}](${data.publicUrl}) `);
    } catch {
      setError("Photo upload failed.");
    } finally {
      setUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };

  const insertAttachment = (item: AttachableObject) => {
    setMenu(null);
    setInput((v) => `${v}${v && !v.endsWith(" ") ? " " : ""}[[${item.kind}:${item.id}|${item.title.replaceAll("]", "")}]] `);
    inputRef.current?.focus();
  };

  /**
   * 첨부를 연다. 문서/코드/시트/링크그래프는 워크스페이스 탭으로, 파일은
   * 미리보기 모달로(내려받지 않고 그 자리에서), 일정은 캘린더로 보낸다.
   */
  const openRef = useCallback(
    (seg: RefToken) => {
      const card = cards.get(cardKey(seg.kind, seg.id));
      const title = card?.title || (seg.title === seg.kind ? "Loading…" : seg.title);

      if (seg.kind === "file") {
        setPreview({ id: seg.id, name: title, mime: card?.mime_type ?? null, size: card?.size_bytes ?? null });
        return;
      }
      if (seg.kind === "event") {
        router.push(`/calendar?event=${seg.id}`);
        return;
      }
      openTab(seg.kind as TabKind, seg.id, title);
    },
    [cards, openTab, router]
  );

  const downloadFile = useCallback(async (fileId: string) => {
    const res = await getSignedUrl(fileId);
    if ("url" in res) triggerDownload(res.url);
    else setError(res.error);
  }, []);

  const refCardApi = useMemo<RefCardApi>(
    () => ({
      cards,
      selfId,
      onOpen: openRef,
      onShareHere: onShareRefHere,
      onRequest: onRequestRefAccess,
      busy: cardBusy,
    }),
    [cards, selfId, openRef, onShareRefHere, onRequestRefAccess, cardBusy]
  );

  // ---- 서식 도구: textarea 선택 영역을 마크다운 문법으로 감싸거나 접두사를 붙인다 ----
  const applyWrap = (before: string, after = before, placeholder = "text") => {
    const el = inputRef.current;
    const s = el?.selectionStart ?? input.length;
    const e = el?.selectionEnd ?? input.length;
    const sel = input.slice(s, e) || placeholder;
    setInput(input.slice(0, s) + before + sel + after + input.slice(e));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(s + before.length, s + before.length + sel.length);
    });
  };

  const applyLinePrefix = (prefix: (lineIndex: number) => string) => {
    const el = inputRef.current;
    const s = el?.selectionStart ?? 0;
    const e = el?.selectionEnd ?? input.length;
    const start = input.lastIndexOf("\n", Math.max(0, s - 1)) + 1;
    const endIdx = input.indexOf("\n", e);
    const end = endIdx === -1 ? input.length : endIdx;
    const next = input
      .slice(start, end)
      .split("\n")
      .map((line, i) => prefix(i) + line)
      .join("\n");
    setInput(input.slice(0, start) + next + input.slice(end));
    requestAnimationFrame(() => el?.focus());
  };

  const insertAtCursor = (text: string) => {
    const el = inputRef.current;
    const s = el?.selectionStart ?? input.length;
    const e = el?.selectionEnd ?? input.length;
    setInput(input.slice(0, s) + text + input.slice(e));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(s + text.length, s + text.length);
    });
  };

  // prompt 는 Tauri 웹뷰에서 null 을 반환하므로 링크 삽입은 모달로 받는다.
  const onLinkButton = () => setLinkUrl("");

  const insertLink = () => {
    const url = (linkUrl ?? "").trim();
    if (!/^https?:\/\//.test(url)) return;
    applyWrap("[", `](${url})`, "link text");
    setLinkUrl(null);
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

  // 플로팅 위젯이거나 모바일 화면에서는 목록/스레드를 한 번에 하나만 보여준다
  // (좁은 화면에서 둘을 동시에 쌓으면 입력창이 잘리고 조작이 불편).
  const single = variant === "float" || isMobile;
  const showList = !single || !activeId;
  const showThread = !single || !!activeId;

  return (
    <RefCardContext.Provider value={refCardApi}>
    <div className={`chat-shell ${variant === "float" ? "float" : ""} ${single ? "single" : ""}`}>
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
                {c.kind === "group" ? (
                  <div className="chat-conv-avatar"><IconGroup size={17} /></div>
                ) : (
                  <UserAvatar url={c.avatar_url} name={c.title} size={34} />
                )}
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
                        ? previewText(c.last_message)
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
                {single && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setActiveId(null)}
                    aria-label="Back to conversations"
                    title="Back"
                  >
                    <IconChevronLeft size={17} />
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
              {/* 좁은 화면에서는 제목이 밀려나므로 메뉴로 접는다. 1:1 이든
                  그룹이든 부를 수 있고, 초대해도 @bigbrother 로 부를 때만 답한다. */}
              {isMobile ? (
                <div className="more-wrap" ref={chatMoreRef}>
                  <button
                    className={`btn btn-sm ${bbEnabled ? "btn-primary" : ""}`}
                    onClick={() => setChatMoreOpen((v) => !v)}
                    aria-label="Conversation actions"
                  >
                    <IconMore size={16} />
                  </button>
                  {chatMoreOpen && (
                    <div className="more-menu">
                      <button
                        onClick={() => {
                          setChatMoreOpen(false);
                          onToggleBigBrother();
                        }}
                      >
                        {bbEnabled ? "Remove Big Brother" : "Invite Big Brother"}
                        <span>Replies only when you write @bigbrother</span>
                      </button>
                      {active.kind === "group" && (
                        <>
                          <button
                            onClick={() => {
                              setChatMoreOpen(false);
                              setDialog("add-members");
                            }}
                          >
                            Add members
                          </button>
                          <button
                            className="danger"
                            onClick={() => {
                              setChatMoreOpen(false);
                              onLeave();
                            }}
                          >
                            Leave conversation
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="row">
                  <button
                    className={`btn btn-sm ${bbEnabled ? "btn-primary" : ""}`}
                    onClick={onToggleBigBrother}
                    title={
                      bbEnabled
                        ? "Big Brother is in this chat. It only replies when you write @bigbrother."
                        : "Invite Big Brother. It stays silent until you write @bigbrother."
                    }
                  >
                    {bbEnabled ? "Big Brother ✓" : "+ Big Brother"}
                  </button>
                  {active.kind === "group" && (
                    <>
                      <button className="btn btn-sm" onClick={() => setDialog("add-members")}>
                        Add members
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={onLeave}>
                        Leave
                      </button>
                    </>
                  )}
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

          {notice && (
            <div style={{ padding: "10px 20px 0" }}>
              <div className="notice notice-ok chat-notice" style={{ margin: 0 }}>
                <span>{notice}</span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setNotice(null)}
                  aria-label="Dismiss"
                >
                  <IconClose size={11} />
                </button>
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
                  <div key={m.id} id={`chat-msg-${m.id}`} className={`chat-msg-row ${mine ? "mine" : ""}`}>
                    {showHead && (
                      <div className="chat-msg-head">
                        {!mine && (
                          <UserAvatar url={m.sender_avatar_url} name={m.sender_name} size={20} />
                        )}
                        {!mine && <span className="chat-msg-sender">{m.sender_name}</span>}
                        <span className="chat-msg-time">{fmtTime(m.created_at)}</span>
                      </div>
                    )}
                    <div className="chat-msg-wrap">
                      <div className={`chat-msg ${mine ? "mine" : "theirs"} ${m.is_bot ? "bot" : ""}`}>
                        {m.reply_to_id && (
                          <button
                            type="button"
                            className="chat-reply-quote"
                            onClick={() =>
                              document
                                .getElementById(`chat-msg-${m.reply_to_id}`)
                                ?.scrollIntoView({ behavior: "smooth", block: "center" })
                            }
                          >
                            <span className="chat-reply-quote-name">
                              {m.reply_to_sender_name ?? "Deleted message"}
                            </span>
                            <span className="chat-reply-quote-text">{m.reply_to_content ?? "—"}</span>
                          </button>
                        )}
                        {editingId === m.id ? (
                          <div className="chat-edit">
                            <textarea
                              className="chat-edit-area"
                              value={editText}
                              autoFocus
                              onChange={(e) => setEditText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  saveEdit();
                                } else if (e.key === "Escape") {
                                  setEditingId(null);
                                }
                              }}
                            />
                            <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                              <button className="btn btn-sm btn-ghost" onClick={() => setEditingId(null)}>
                                Cancel
                              </button>
                              <button className="btn btn-sm btn-primary" onClick={saveEdit} disabled={!editText.trim()}>
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <CollapsibleBody content={m.content} />
                            {m.edited_at && <span className="chat-edited">(edited)</span>}
                          </>
                        )}
                      </div>
                      {editingId !== m.id && (
                        <div className={`chat-msg-actions ${reactMenuFor === m.id ? "force-visible" : ""}`}>
                          <button className="chat-msg-act" title="Reply" onClick={() => setReplyTo(m)}>
                            <IconReply size={15} />
                          </button>
                          <div className="chat-react-popover">
                            <button
                              className="chat-msg-act"
                              title="React"
                              onClick={() => setReactMenuFor((v) => (v === m.id ? null : m.id))}
                            >
                              <IconSmile size={15} />
                            </button>
                            {reactMenuFor === m.id && (
                              <div className="chat-react-menu">
                                {QUICK_REACTIONS.map((e) => (
                                  <button
                                    key={e}
                                    className="chat-react-menu-btn"
                                    onClick={() => onToggleReaction(m.id, e)}
                                  >
                                    {e}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          {mine && (
                            <>
                              <button className="chat-msg-act" title="Edit" onClick={() => startEdit(m)}>
                                <IconEdit size={15} />
                              </button>
                              <button className="chat-msg-act" title="Delete" onClick={() => onDeleteMessage(m.id)}>
                                <IconTrash size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    {m.reactions && m.reactions.length > 0 && (
                      <div className="chat-reactions">
                        {m.reactions.map((r) => (
                          <button
                            key={r.emoji}
                            className={`chat-reaction-pill ${r.reacted_by_me ? "active" : ""}`}
                            onClick={() => onToggleReaction(m.id, r.emoji)}
                          >
                            {r.emoji} {r.count}
                          </button>
                        ))}
                      </div>
                    )}
                    {mine && readReceipt && lastMine?.id === m.id && (
                      <span className={`chat-receipt ${readReceipt.startsWith("Read") ? "read" : ""}`}>
                        {readReceipt}
                      </span>
                    )}
                  </div>
                );
              })}
            {activeId && !loading && messages.length === 0 && (
              <div className="chat-empty">
                <span className="chat-empty-icon">
                  <IconChat size={30} />
                </span>
                <span className="chat-empty-title">You&rsquo;re starting a new conversation</span>
                <span className="chat-empty-sub">Type your first message below.</span>
              </div>
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
            {/* 부르고 나서 답이 오기까지 몇십 초가 걸릴 수 있다 — 침묵처럼 보이면 안 된다. */}
            {bbThinking && (
              <div className="chat-typing">
                <ThinkingIndicator label="Big Brother is working" compact />
              </div>
            )}
          </div>

          {activeId && (
            <div className="chat-composer">
              {replyTo && (
                <div className="chat-reply-banner">
                  <span className="chat-reply-banner-name">Replying to {replyTo.sender_name}</span>
                  <span className="chat-reply-banner-text">{replyTo.content}</span>
                  <button
                    type="button"
                    className="chat-reply-banner-close"
                    onClick={() => setReplyTo(null)}
                    aria-label="Cancel reply"
                  >
                    <IconClose size={12} />
                  </button>
                </div>
              )}
              {fmtOpen && (
                <div className="chat-fmt-bar">
                  <button className="chat-fmt-btn" title="Bold (**text**)" onClick={() => applyWrap("**")}>
                    <b>B</b>
                  </button>
                  <button className="chat-fmt-btn" title="Italic (*text*)" onClick={() => applyWrap("*")}>
                    <i>I</i>
                  </button>
                  <button className="chat-fmt-btn" title="Underline (__text__)" onClick={() => applyWrap("__")}>
                    <u>U</u>
                  </button>
                  <button className="chat-fmt-btn" title="Strikethrough (~~text~~)" onClick={() => applyWrap("~~")}>
                    <s>S</s>
                  </button>
                  <span className="chat-fmt-sep" />
                  <button className="chat-fmt-btn" title="Insert link" onClick={onLinkButton}>
                    <IconLink size={13} />
                  </button>
                  <span className="chat-fmt-sep" />
                  <button
                    className="chat-fmt-btn"
                    title="Numbered list"
                    onClick={() => applyLinePrefix((i) => `${i + 1}. `)}
                  >
                    1.
                  </button>
                  <button className="chat-fmt-btn" title="Bulleted list" onClick={() => applyLinePrefix(() => "• ")}>
                    •
                  </button>
                  <button className="chat-fmt-btn" title="Indent" onClick={() => applyLinePrefix(() => "    ")}>
                    <IconIndent size={14} />
                  </button>
                  <span className="chat-fmt-sep" />
                  <button className="chat-fmt-btn mono" title="Inline code (`code`)" onClick={() => applyWrap("`", "`", "code")}>
                    {"</>"}
                  </button>
                  <button
                    className="chat-fmt-btn mono"
                    title="Code block"
                    onClick={() => applyWrap("\n```\n", "\n```\n", "code")}
                  >
                    {"{ }"}
                  </button>
                </div>
              )}
              <div className="chat-input-bar">
                <div className="chat-plus" ref={plusRef}>
                  <button
                    className={`btn chat-plus-btn ${menu ? "chat-tool-active" : ""}`}
                    onClick={() => setMenu((m) => (m ? null : "root"))}
                    title="More options"
                    aria-label="More options"
                    aria-expanded={!!menu}
                  >
                    <IconPlus size={16} />
                  </button>
                  {menu === "root" && (
                    <div className="chat-attach-menu chat-plus-menu">
                      <button
                        className="chat-attach-item"
                        onClick={() => {
                          setMenu(null);
                          photoInputRef.current?.click();
                        }}
                        disabled={uploadingPhoto}
                      >
                        <span className="chat-menu-icon"><IconImage size={15} /></span>
                        {uploadingPhoto ? "Uploading photo…" : "Send a photo"}
                      </button>
                      <button className="chat-attach-item" onClick={openAttachMenu}>
                        <span className="chat-menu-icon"><IconClip size={15} /></span>
                        Attach workspace item
                      </button>
                      <button
                        className="chat-attach-item"
                        onClick={() => {
                          setFmtOpen((v) => !v);
                          setMenu(null);
                        }}
                      >
                        <span className="chat-menu-icon chat-menu-glyph">Aa</span>
                        Text formatting
                        <span className={`chat-menu-state ${fmtOpen ? "on" : ""}`}>
                          {fmtOpen ? "ON" : "OFF"}
                        </span>
                      </button>
                      <button className="chat-attach-item" onClick={() => setMenu("emoji")}>
                        <span className="chat-menu-icon"><IconSmile size={15} /></span>
                        Emoji
                      </button>
                      <button className="chat-attach-item" onClick={() => setMenu("mention")}>
                        <span className="chat-menu-icon chat-menu-glyph">@</span>
                        Mention
                      </button>
                    </div>
                  )}
                  {menu === "attach" && (
                    <div className="chat-attach-menu chat-plus-menu">
                      <button className="chat-attach-item chat-menu-back" onClick={() => setMenu("root")}>
                        <IconChevronLeft size={13} /> Back
                      </button>
                      <div className="chat-attach-head label">ATTACH — DOCS, FILES, EVENTS</div>
                      <input
                        className="input chat-attach-search"
                        placeholder="Search by name…"
                        value={attachQuery}
                        onChange={(e) => setAttachQuery(e.target.value)}
                        autoFocus
                      />
                      {!attachables && <div className="chat-empty" style={{ padding: 14 }}>Loading…</div>}
                      {attachables?.length === 0 && (
                        <div className="chat-empty" style={{ padding: 14 }}>
                          {attachQuery.trim() ? "Nothing matches." : "Nothing to attach yet."}
                        </div>
                      )}
                      {attachables?.map((item) => (
                        <button
                          key={`${item.kind}:${item.id}`}
                          className="chat-attach-item"
                          onClick={() => insertAttachment(item)}
                        >
                          <span className="chat-ref-kind">{KIND_LABEL[item.kind] ?? item.kind}</span>
                          <span className="chat-attach-title">{item.title}</span>
                        </button>
                      ))}
                      <div className="chat-attach-foot">
                        Sending an attachment also gives everyone here access to it.
                      </div>
                    </div>
                  )}
                  {menu === "emoji" && (
                    <div className="chat-attach-menu chat-plus-menu chat-emoji-menu">
                      <button className="chat-attach-item chat-menu-back" onClick={() => setMenu("root")}>
                        <IconChevronLeft size={13} /> Back
                      </button>
                      <div className="chat-emoji-grid">
                        {EMOJIS.map((e) => (
                          <button
                            key={e}
                            className="chat-emoji-btn"
                            onClick={() => {
                              setMenu(null);
                              insertAtCursor(e);
                            }}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {menu === "mention" && (
                    <div className="chat-attach-menu chat-plus-menu">
                      <button className="chat-attach-item chat-menu-back" onClick={() => setMenu("root")}>
                        <IconChevronLeft size={13} /> Back
                      </button>
                      <div className="chat-attach-head label">MENTION</div>
                      {members
                        .filter((m) => m.user_id !== selfId)
                        .map((m) => (
                          <button
                            key={m.user_id}
                            className="chat-attach-item"
                            onClick={() => {
                              setMenu(null);
                              insertAtCursor(`@${m.name} `);
                            }}
                          >
                            <UserAvatar url={m.avatar_url} name={m.name} size={24} />
                            <span className="chat-attach-title">{m.name}</span>
                          </button>
                        ))}
                      {members.filter((m) => m.user_id !== selfId).length === 0 && (
                        <div className="chat-empty" style={{ padding: 14 }}>No other members.</div>
                      )}
                    </div>
                  )}
                </div>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadPhoto(f);
                  }}
                />
                <textarea
                  ref={inputRef}
                  className="chat-textarea"
                  placeholder="Message"
                  rows={1}
                  value={input}
                  onChange={(e) => onInputChange(e.target.value)}
                  onKeyDown={onKeyDown}
                  disabled={sending}
                />
                <button
                  className="chat-send-btn"
                  onClick={onSend}
                  disabled={sending || !input.trim()}
                  aria-label="Send message"
                  title="Send (Enter)"
                >
                  <IconSend size={17} />
                </button>
              </div>
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
      {linkUrl !== null && (
        <Modal title="Insert link" onClose={() => setLinkUrl(null)}>
          <input
            className="input"
            autoFocus
            placeholder="https://…"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && insertLink()}
            style={{ marginBottom: 12 }}
          />
          <button
            className="btn btn-primary btn-block"
            onClick={insertLink}
            disabled={!/^https?:\/\//.test(linkUrl.trim())}
          >
            Insert
          </button>
        </Modal>
      )}
      {preview && (
        <FilePreview
          target={preview}
          loadUrl={getPreviewUrl}
          onDownload={() => downloadFile(preview.id)}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
    </RefCardContext.Provider>
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
            <UserAvatar url={c.avatar_url} name={contactName(c)} size={30} />
            <span className="chat-contact-body">
              <span className="chat-contact-name">{contactName(c)}</span>
              <span className="chat-contact-email">{c.email}</span>
            </span>
            {mode === "group" && (
              <span className="chat-contact-check"><IconCheckSquare size={15} checked={selected.has(c.id)} /></span>
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
            <UserAvatar url={c.avatar_url} name={contactName(c)} size={30} />
            <span className="chat-contact-body">
              <span className="chat-contact-name">{contactName(c)}</span>
              <span className="chat-contact-email">{c.email}</span>
            </span>
            <span className="chat-contact-check"><IconCheckSquare size={15} checked={selected.has(c.id)} /></span>
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
