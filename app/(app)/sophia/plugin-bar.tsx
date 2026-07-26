"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/modal";
import { IconClose } from "../icons";
import {
  attachPlugin,
  detachPlugin,
  listPluginCandidates,
  listPlugins,
} from "./plugin-actions";
import {
  PLUGIN_LABEL,
  type Plugin,
  type PluginCandidate,
  type PluginKind,
} from "./plugin-types";

/**
 * 대화에 연결된 항목(Plugin) 바.
 *
 * 붙여 두면 어시스턴트가 검색으로 대상을 추측하지 않고 그 id 로 바로 작업한다
 * — 엉뚱한 문서를 덮어쓰는 사고와 매 턴의 검색 토큰이 함께 사라진다.
 */
export function PluginBar({
  conversationId,
  onChanged,
}: {
  conversationId: string | null;
  onChanged?: () => void;
}) {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [picking, setPicking] = useState(false);

  const reload = useMemo(
    () => async () => {
      if (!conversationId) {
        setPlugins([]);
        return;
      }
      try {
        setPlugins(await listPlugins(conversationId));
      } catch {
        setPlugins([]);
      }
    },
    [conversationId]
  );

  useEffect(() => {
    reload();
  }, [reload]);

  const detach = async (p: Plugin) => {
    if (!conversationId) return;
    await detachPlugin(conversationId, p.kind, p.objectId);
    await reload();
    onChanged?.();
  };

  return (
    <div className="plugin-bar">
      <button
        className="plugin-add"
        onClick={() => setPicking(true)}
        disabled={!conversationId}
        title={
          conversationId
            ? "Connect a doc, sheet, link graph, Code Space or repository"
            : "Send a message first to start the conversation"
        }
      >
        + Connect
      </button>

      {plugins.map((p) => (
        <span key={`${p.kind}:${p.objectId}`} className="plugin-chip" title={p.subtitle ?? p.title}>
          <span className="plugin-kind">{PLUGIN_LABEL[p.kind]}</span>
          <span className="plugin-name">{p.title}</span>
          <button className="plugin-x" onClick={() => detach(p)} aria-label={`Disconnect ${p.title}`}>
            <IconClose size={11} />
          </button>
        </span>
      ))}

      {plugins.length === 0 && conversationId && (
        <span className="plugin-hint">
          Connect an item and Big Brother will work on it directly.
        </span>
      )}

      {picking && conversationId && (
        <PluginPicker
          conversationId={conversationId}
          attached={new Set(plugins.map((p) => `${p.kind}:${p.objectId}`))}
          onClose={() => setPicking(false)}
          onAttached={async () => {
            await reload();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

function PluginPicker({
  conversationId,
  attached,
  onClose,
  onAttached,
}: {
  conversationId: string;
  attached: Set<string>;
  onClose: () => void;
  onAttached: () => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PluginCandidate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 실패를 삼키면 "Loading…" 이 영원히 남는다 — 원인을 화면에 띄운다.
  useEffect(() => {
    let alive = true;
    listPluginCandidates(query).then(
      (r) => alive && setItems(r),
      (e) => {
        if (!alive) return;
        setItems([]);
        setError(e instanceof Error ? e.message : "Could not load your items.");
      }
    );
    return () => {
      alive = false;
    };
  }, [query]);

  const add = async (c: PluginCandidate) => {
    setBusy(`${c.kind}:${c.id}`);
    setError(null);
    const res = await attachPlugin(conversationId, c.kind as PluginKind, c.id);
    setBusy(null);
    if ("error" in res) setError(res.error);
    else onAttached();
  };

  return (
    <Modal title="Connect to this conversation" onClose={onClose} width={520}>
      {error && <div className="notice notice-error">{error}</div>}
      <input
        className="input"
        style={{ width: "100%" }}
        placeholder="Search your docs, tables, link graphs, Code Spaces, repositories…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <div className="plugin-list">
        {items === null ? (
          <div className="empty">Loading…</div>
        ) : items.length === 0 ? (
          <div className="empty">Nothing matches.</div>
        ) : (
          items.map((c) => {
            const key = `${c.kind}:${c.id}`;
            const already = attached.has(key);
            return (
              <button
                key={key}
                className="plugin-row"
                disabled={already || busy === key}
                onClick={() => add(c)}
              >
                <span className="plugin-kind">{PLUGIN_LABEL[c.kind]}</span>
                <span className="plugin-row-title">{c.title}</span>
                {c.subtitle && <span className="plugin-row-sub">{c.subtitle}</span>}
                <span className="plugin-row-action">
                  {already ? "Connected" : busy === key ? "…" : "Connect"}
                </span>
              </button>
            );
          })
        )}
      </div>
      <p className="page-sub" style={{ marginTop: 10, fontSize: 11.5 }}>
        Connected items are passed to Big Brother with their ids, so it edits exactly what
        you meant instead of searching for a match.
      </p>
    </Modal>
  );
}
