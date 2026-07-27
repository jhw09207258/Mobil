"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/modal";
import { UserAvatar } from "@/components/user-avatar";

/**
 * "이 자료를 대화로 보낸다" 한 화면.
 *
 * 중요한 건 목록이 아니라 마지막 줄이다 — 보내면 상대가 **볼 수 있게 된다**는
 * 사실을 보내기 전에 말해 준다. 그래야 "보냈는데 왜 안 열려?" 가 사라진다.
 */

export type ChatTarget = {
  id: string;
  title: string;
  kind: "dm" | "group";
  avatar_url: string | null;
  member_count: number;
};

export type ContactTarget = {
  id: string;
  display_name: string | null;
  email: string;
  avatar_url: string | null;
};

export type ShareToChatResult = {
  canGrant: boolean;
  granted: number;
  members: number;
  already: number;
};

export function ShareToChatDialog({
  itemLabel,
  itemKind,
  canGrantHint = true,
  loadTargets,
  onSend,
  onStartDm,
  onClose,
}: {
  itemLabel: string;
  itemKind: string;
  /** 내가 소유자가 아니면 권한 선택을 숨긴다(줄 수 없는 것을 고르게 하지 않는다). */
  canGrantHint?: boolean;
  loadTargets: () => Promise<{ conversations: ChatTarget[]; contacts: ContactTarget[] }>;
  onSend: (
    conversationId: string,
    note: string,
    permission: "view" | "edit"
  ) => Promise<{ ok: true; share: ShareToChatResult } | { error: string }>;
  /** 아직 대화가 없는 사람에게 보낼 때 — DM 을 먼저 만든다. */
  onStartDm: (userId: string) => Promise<{ id: string } | { error: string }>;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ conversations: ChatTarget[]; contacts: ContactTarget[] } | null>(
    null
  );
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [permission, setPermission] = useState<"view" | "edit">("view");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ where: string; share: ShareToChatResult } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTargets().then(
      (d) => {
        if (!cancelled) setData(d);
      },
      () => {
        if (!cancelled) setError("Could not load your conversations.");
      }
    );
    return () => {
      cancelled = true;
    };
  }, [loadTargets]);

  const q = query.trim().toLowerCase();

  const conversations = useMemo(() => {
    const list = data?.conversations ?? [];
    return q ? list.filter((c) => c.title.toLowerCase().includes(q)) : list;
  }, [data, q]);

  // 이미 DM 이 있는 사람은 대화 목록에 나오므로 연락처에서 뺀다 — 같은 사람이
  // 두 줄로 보이면 어느 쪽을 눌러야 할지 알 수 없다.
  const contacts = useMemo(() => {
    const existing = new Set(
      (data?.conversations ?? []).filter((c) => c.kind === "dm").map((c) => c.title.toLowerCase())
    );
    return (data?.contacts ?? []).filter((p) => {
      const name = (p.display_name || p.email).toLowerCase();
      if (existing.has(name)) return false;
      return !q || name.includes(q);
    });
  }, [data, q]);

  const send = async (conversationId: string, where: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await onSend(conversationId, note, permission);
    setBusy(false);
    if ("error" in res) setError(res.error);
    else setDone({ where, share: res.share });
  };

  const sendToContact = async (contact: ContactTarget) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const dm = await onStartDm(contact.id);
    setBusy(false);
    if ("error" in dm) {
      setError(dm.error);
      return;
    }
    await send(dm.id, contact.display_name || contact.email);
  };

  if (done) {
    const { share, where } = done;
    return (
      <Modal title="Sent" onClose={onClose} width={440}>
        <div className="notice notice-ok" style={{ marginBottom: 12 }}>
          Sent to <strong>{where}</strong>.
        </div>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
          {!share.canGrant
            ? "You are not the owner, so access was not granted. Anyone without access will see a “Request access” button on the card."
            : share.granted > 0
              ? `${share.granted} ${share.granted === 1 ? "person" : "people"} were given ${permission} access — they can open it straight from the message.`
              : share.members === 0
                ? "No one else is in that conversation yet."
                : "Everyone there could already open it."}
        </p>
        <button className="btn btn-primary btn-block" onClick={onClose}>
          Done
        </button>
      </Modal>
    );
  }

  return (
    <Modal title={`Send ${itemKind} to chat`} onClose={onClose} width={480}>
      <div className="stc-item">
        <span className="badge">{itemKind}</span>
        <span className="stc-item-name" title={itemLabel}>
          {itemLabel}
        </span>
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      <div className="field">
        <textarea
          className="input stc-note"
          rows={2}
          placeholder="Add a message (optional) — e.g. “Please check section 3.”"
          value={note}
          maxLength={800}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {canGrantHint && (
        <div className="field">
          <label className="label" htmlFor="stc-perm">
            ACCESS TO GRANT
          </label>
          <select
            id="stc-perm"
            className="select"
            value={permission}
            onChange={(e) => setPermission(e.target.value as "view" | "edit")}
          >
            <option value="view">Can view — everyone in the chat can open it</option>
            <option value="edit">Can edit — everyone in the chat can change it</option>
          </select>
        </div>
      )}

      <input
        className="input"
        placeholder="Search people or groups…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginBottom: 10 }}
      />

      <div className="stc-list">
        {!data && <div className="empty">Loading…</div>}
        {data && conversations.length === 0 && contacts.length === 0 && (
          <div className="empty">No conversations or people match.</div>
        )}

        {conversations.length > 0 && <div className="stc-head label">CONVERSATIONS</div>}
        {conversations.map((c) => (
          <button
            key={c.id}
            className="stc-row"
            disabled={busy}
            onClick={() => send(c.id, c.title)}
          >
            <UserAvatar url={c.avatar_url} name={c.title} size={28} />
            <span className="stc-row-main">
              <span className="stc-row-title">{c.title}</span>
              <span className="stc-row-sub">
                {c.kind === "group" ? `Group · ${c.member_count} members` : "Direct message"}
              </span>
            </span>
            <span className="stc-send">Send</span>
          </button>
        ))}

        {contacts.length > 0 && <div className="stc-head label">START A NEW CHAT</div>}
        {contacts.map((p) => (
          <button key={p.id} className="stc-row" disabled={busy} onClick={() => sendToContact(p)}>
            <UserAvatar url={p.avatar_url} name={p.display_name || p.email} size={28} />
            <span className="stc-row-main">
              <span className="stc-row-title">{p.display_name || p.email}</span>
              <span className="stc-row-sub">{p.email}</span>
            </span>
            <span className="stc-send">Send</span>
          </button>
        ))}
      </div>

      <style>{shareCss}</style>
    </Modal>
  );
}

const shareCss = `
.stc-item {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; margin-bottom: 12px;
  border: 1px solid var(--border-0);
  border-radius: var(--radius);
  background: var(--bg-1);
}
.stc-item-name {
  font-size: 13px; color: var(--text-0);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.stc-note { resize: vertical; min-height: 52px; padding: 8px 10px; height: auto; }
.stc-list {
  max-height: 300px; overflow-y: auto;
  border: 1px solid var(--border-0);
  border-radius: var(--radius);
}
.stc-head { padding: 8px 12px 4px; display: block; }
.stc-row {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 8px 12px;
  background: none; border: 0; cursor: pointer;
  text-align: left; color: var(--text-1);
  transition: background 0.15s var(--ease-spring);
}
.stc-row:hover:not(:disabled) { background: var(--bg-3); }
.stc-row:disabled { opacity: 0.5; cursor: progress; }
.stc-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.stc-row-title {
  font-size: 13px; color: var(--text-0);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.stc-row-sub { font-size: 11px; color: var(--text-3); }
.stc-send {
  font-size: 11px; color: var(--create);
  border: 1px solid var(--create-dim); border-radius: 999px;
  padding: 2px 10px;
}
`;
