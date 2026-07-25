"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { SearchResult } from "../../search/actions";

const KIND_LABEL: Record<string, string> = {
  document: "Docs +",
  code: "Code",
  sheet: "Table",
  mindmap: "Link Graph",
};

export type MentionMenuRef = {
  onKeyDown: (e: { event: KeyboardEvent }) => boolean;
};

export const MentionMenu = forwardRef<
  MentionMenuRef,
  { items: SearchResult[]; command: (item: SearchResult) => void }
>(function MentionMenu({ items, command }, ref) {
  const [index, setIndex] = useState(0);

  useEffect(() => setIndex(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowDown") {
        setIndex((i) => (i + 1) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === "ArrowUp") {
        setIndex((i) => (i - 1 + items.length) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === "Enter") {
        if (items[index]) command(items[index]);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="slash-menu">
        <div className="slash-empty">No matching items</div>
      </div>
    );
  }

  return (
    <div className="slash-menu">
      {items.map((item, i) => (
        <button
          key={`${item.kind}:${item.id}`}
          type="button"
          className={`slash-item ${i === index ? "active" : ""}`}
          onMouseEnter={() => setIndex(i)}
          onClick={() => command(item)}
        >
          <span className="slash-item-icon">{(KIND_LABEL[item.kind] ?? item.kind)[0]}</span>
          <span className="slash-item-text">
            <span className="slash-item-title">{item.title || "Untitled"}</span>
            <span className="slash-item-desc">{KIND_LABEL[item.kind] ?? item.kind}</span>
          </span>
        </button>
      ))}
    </div>
  );
});
