"use client";

import { useState } from "react";
import { SophiaChat } from "../sophia/sophia-chat";
import type { ConversationRow } from "../sophia/actions";
import { BigBrotherSearch } from "./big-brother-search";
import { AgentMode } from "./agent-mode";
import "./big-brother.css";

/**
 * Big Brother — 대화형 어시스턴트(온톨로지·RAG 도구를 쓰는 LLM)와 직접 검색
 * 콘솔(논문·GitHub)을 한 화면에서 전환한다. 어시스턴트가 기본 — 검색 스킬
 * (search_papers_and_code)은 도구로도 흡수되어 있어 대화만으로도 외부 검색이
 * 되고, 콘솔은 LLM 없이 빠르게 훑고 싶을 때 쓴다.
 */
export function BigBrotherShell({
  initialConversations,
}: {
  initialConversations: ConversationRow[];
}) {
  const [mode, setMode] = useState<"assistant" | "agent" | "search">("assistant");

  return (
    <>
      <div className="bb-mode-bar">
        <button
          className={`category-tab ${mode === "assistant" ? "active" : ""}`}
          onClick={() => setMode("assistant")}
        >
          Assistant
        </button>
        <button
          className={`category-tab ${mode === "agent" ? "active" : ""}`}
          onClick={() => setMode("agent")}
        >
          Agent
        </button>
        <button
          className={`category-tab ${mode === "search" ? "active" : ""}`}
          onClick={() => setMode("search")}
        >
          Search console
        </button>
      </div>
      {mode === "assistant" ? (
        <SophiaChat initialConversations={initialConversations} />
      ) : mode === "agent" ? (
        <AgentMode />
      ) : (
        <div className="content">
          <BigBrotherSearch />
        </div>
      )}
    </>
  );
}
