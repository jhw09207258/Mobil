"use client";

import { IconDocuments, IconCode, IconSheet, IconMindmap, IconChat } from "../icons";
import { useWorkspace, type Tab } from "./workspace-context";
import { useIsMobile } from "@/lib/use-media-query";

const KIND_ICON = {
  document: IconDocuments,
  code: IconCode,
  sheet: IconSheet,
  mindmap: IconMindmap,
  chat: IconChat,
};

function TabChip({ tab }: { tab: Tab }) {
  const { paneLeft, paneRight, open, focusTab, closeTab } = useWorkspace();
  const inPane = tab.id === paneLeft || tab.id === paneRight;
  const active = open && inPane;
  const Icon = KIND_ICON[tab.kind];

  return (
    <div
      className={`wk-tab ${active ? "active" : inPane ? "in-pane" : ""}`}
      onClick={() => focusTab(tab.id, tab.id === paneRight ? "right" : "left")}
      title={tab.title}
    >
      <span className="wk-tab-icon">
        <Icon size={13} />
      </span>
      <span className="wk-tab-title">{tab.title}</span>
      <span
        className="wk-tab-close"
        onClick={(e) => {
          e.stopPropagation();
          closeTab(tab.id);
        }}
        title="Close"
      >
        ✕
      </span>
    </div>
  );
}

export function TabBar() {
  const { tabs, split, open, toggleSplit, hide } = useWorkspace();
  const isMobile = useIsMobile();

  if (tabs.length === 0) return null;

  return (
    <div className="wk-bar">
      <div className="wk-tabs">
        {tabs.map((t) => (
          <TabChip key={t.id} tab={t} />
        ))}
      </div>
      <div className="wk-bar-actions">
        {!isMobile && (
          <button
            className={`wk-icon-btn ${split ? "on" : ""}`}
            onClick={toggleSplit}
            title="Toggle split view (max 2)"
            aria-label="Toggle split view"
          >
            ⬓
          </button>
        )}
        {open && (
          <button
            className="wk-icon-btn"
            onClick={hide}
            title="Hide (browse other pages)"
            aria-label="Hide workspace"
          >
            ⌄
          </button>
        )}
      </div>
    </div>
  );
}
