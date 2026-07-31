"use client";

import { useEffect, useState } from "react";
import { tabId, useWorkspace, type TabKind } from "./workspace-context";
import { getDocumentForTab } from "../documents/actions";
import { getCodeFileForTab } from "../code/actions";
import { getSheetForTab } from "../sheets/actions";
import { getMindMapForTab } from "../mindmap/actions";
import { DocumentEditorLoader } from "../documents/[id]/editor-loader";
import { CodeEditor } from "../code/[id]/code-editor";
import { SpreadsheetLoader } from "../sheets/[id]/spreadsheet-loader";
import { MindMapCanvasLoader } from "../mindmap/[id]/canvas-loader";
import { ChatTab } from "../chat/chat-tab";

export function TabContent({ kind, itemId }: { kind: TabKind; itemId: string }) {
  const { consumeSeed } = useWorkspace();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    | { status: "ready"; data: any }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    // 채팅 탭은 자체적으로 데이터를 불러온다(아래 ChatTab) — 이 로더는 무시.
    if (kind === "chat") return;

    // 방금 만든 항목이면(NewItemButton 이 openTab 에 시드를 실어 보냄) 이미
    // 전체 데이터를 알고 있으므로 서버 재조회를 건너뛴다 — auth 확인 + 본문
    // 조회 + 권한 조회로 이어지는 왕복을 없앤다. 목록/검색에서 연 기존 탭이나
    // 새로고침 후 복원된 탭에는 시드가 없어 평소대로 조회한다.
    const seed = consumeSeed(tabId(kind, itemId));
    if (seed !== undefined) {
      setState({ status: "ready", data: seed });
      return;
    }

    setState({ status: "loading" });

    const load = async () => {
      try {
        let data: unknown = null;
        if (kind === "document") data = await getDocumentForTab(itemId);
        else if (kind === "code") data = await getCodeFileForTab(itemId);
        else if (kind === "sheet") data = await getSheetForTab(itemId);
        else if (kind === "mindmap") data = await getMindMapForTab(itemId);

        if (cancelled) return;
        if (!data) {
          setState({ status: "error", message: "Not found or access denied." });
          return;
        }
        setState({ status: "ready", data });
      } catch (e) {
        if (cancelled) return;
        setState({
          status: "error",
          message: e instanceof Error ? e.message : "Failed to load.",
        });
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [kind, itemId, consumeSeed]);

  if (kind === "chat") {
    return <ChatTab />;
  }

  if (state.status === "loading") {
    return <div className="wk-loading">Loading…</div>;
  }
  if (state.status === "error") {
    return (
      <div className="wk-loading">
        <div className="notice notice-error" style={{ margin: 16 }}>
          {state.message}
        </div>
      </div>
    );
  }

  const d = state.data;
  if (kind === "document") {
    return (
      <DocumentEditorLoader
        docId={d.id}
        initialTitle={d.title}
        initialContent={d.content}
        initialYjsState={d.initialYjsState}
        canEdit={d.canEdit}
        isOwner={d.isOwner}
        visibility={d.visibility}
        myShareId={d.myShareId}
        myName={d.myName}
        myAvatarUrl={d.myAvatarUrl}
      />
    );
  }
  if (kind === "code") {
    return (
      <CodeEditor
        fileId={d.id}
        initialName={d.name}
        initialLanguage={d.language}
        initialContent={d.content}
        initialYjsState={d.initialYjsState}
        canEdit={d.canEdit}
        isOwner={d.isOwner}
        isPublic={d.isPublic}
        myShareId={d.myShareId}
        myName={d.myName}
        myAvatarUrl={d.myAvatarUrl}
      />
    );
  }
  if (kind === "sheet") {
    return (
      <SpreadsheetLoader
        sheetId={d.id}
        initialTitle={d.title}
        initialData={d.data}
        initialYjsState={d.initialYjsState}
        canEdit={d.canEdit}
        isOwner={d.isOwner}
        isPublic={d.isPublic}
        myShareId={d.myShareId}
        myName={d.myName}
        myAvatarUrl={d.myAvatarUrl}
      />
    );
  }
  if (kind === "mindmap") {
    return (
      <MindMapCanvasLoader
        mapId={d.id}
        initialTitle={d.title}
        initialData={d.data}
        initialYjsState={d.initialYjsState}
        canEdit={d.canEdit}
        isOwner={d.isOwner}
        isPublic={d.isPublic}
        myShareId={d.myShareId}
        myName={d.myName}
        myAvatarUrl={d.myAvatarUrl}
        items={d.items}
      />
    );
  }
  return null;
}
