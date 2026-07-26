"use client";

import { useState } from "react";
import { IconDocuments, IconCode, IconSheet, IconMindmap, IconChat, IconClose, IconSplit, IconChevronDown } from "../icons";
import { useWorkspace, type Tab } from "./workspace-context";
import { useIsMobile } from "@/lib/use-media-query";

const KIND_ICON = {
  document: IconDocuments,
  code: IconCode,
  sheet: IconSheet,
  mindmap: IconMindmap,
  chat: IconChat,
};

function TabChip({
  tab,
  dragId,
  setDragId,
}: {
  tab: Tab;
  dragId: string | null;
  setDragId: (id: string | null) => void;
}) {
  const { paneLeft, paneRight, open, focusTab, closeTab, reorderTab } = useWorkspace();
  const [dragOver, setDragOver] = useState(false);
  const inPane = tab.id === paneLeft || tab.id === paneRight;
  const active = open && inPane;
  const Icon = KIND_ICON[tab.kind];

  return (
    <div
      className={`wk-tab ${active ? "active" : inPane ? "in-pane" : ""} ${
        dragOver && dragId !== tab.id ? "drop-target" : ""
      } ${dragId === tab.id ? "dragging" : ""}`}
      onClick={() => focusTab(tab.id, tab.id === paneRight ? "right" : "left")}
      title={tab.title}
      // 드래그로 탭 순서 재배치
      draggable
      onDragStart={(e) => {
        setDragId(tab.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => setDragId(null)}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (dragId && dragId !== tab.id) reorderTab(dragId, tab.id);
        setDragId(null);
      }}
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
        <IconClose size={11} />
      </span>
    </div>
  );
}

export function TabBar() {
  const { tabs, split, open, toggleSplit, hide } = useWorkspace();
  const isMobile = useIsMobile();
  const [dragId, setDragId] = useState<string | null>(null);

  if (tabs.length === 0) return null;

  return (
    <div className="wk-bar">
      <div className="wk-tabs">
        {tabs.map((t) => (
          <TabChip key={t.id} tab={t} dragId={dragId} setDragId={setDragId} />
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
            <IconSplit size={15} />
          </button>
        )}
        {open && (
          <button
            className="wk-icon-btn"
            onClick={hide}
            title="Hide (browse other pages)"
            aria-label="Hide workspace"
          >
            <IconChevronDown size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
