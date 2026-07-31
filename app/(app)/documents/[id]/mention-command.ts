import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import { MentionMenu, type MentionMenuRef } from "./mention-menu";
import { searchOntology, type SearchResult } from "../../search/actions";

// @ 로, 그리고(Obsidian 을 써 본 사람에게 익숙하도록) [[ 로도 다른 워크스페이스
// 항목(문서/코드/시트/맵)을 검색해 링크 칩으로 삽입한다. 위치/키보드 처리는
// slash-command.ts 와 동일한 패턴.
//
// Obsidian 의 [[위키링크]] 는 제목을 "타이핑"하면 그 텍스트 자체가 링크가 되고,
// 대상 문서 제목이 바뀌면 렌더링 시점에 다시 그 파일을 찾아 표시 텍스트가 같이
// 바뀐다(파일명이 곧 식별자이므로 가능한 방식). 이 에디터는 워크스페이스 링크를
// 텍스트가 아니라 노드로 저장하고 식별자는 제목이 아니라 안정적인 UUID
// (refId)다 — 문서 제목이 중복되거나 바뀌어도 링크가 깨지지 않는다는 점에서
// 오히려 더 안전하다. 다만 그 대가로 칩에 박아 둔 표시 텍스트(label)는 삽입
// 시점의 스냅샷이라 저절로 갱신되지 않는다 — 이 "자동 갱신"에 해당하는 부분은
// editor.tsx 의 resolveStaleWorkspaceLinks() 가 문서를 열 때 한 번씩 맡는다
// (get_object_cards 로 일괄 조회해 실제 제목과 다르면 바로잡는다).
const TAB_KINDS = new Set(["document", "code", "sheet", "mindmap"]);

// Suggestion 은 pluginKey 를 주지 않으면 전부 공용 기본 키(suggestion)를 쓴다.
// 그러면 같은 에디터에 붙는 여러 Suggestion(@ 멘션 + [[ 위키링크 +
// slash-command 의 /)에서 ProseMirror 가 "Adding different instances of a
// keyed plugin (suggestion$)" 로 죽어 에디터 전체가 뜨지 않는다 — 반드시
// 서로 다른 키를 준다.
function buildLinkSuggestion(editor: Parameters<typeof Suggestion>[0]["editor"], char: string, pluginKey: PluginKey) {
  return Suggestion<SearchResult, SearchResult>({
    editor,
    pluginKey,
    char,
    startOfLine: false,
    command: ({ editor: ed, range, props }) => {
      ed.chain()
        .focus()
        .deleteRange(range)
        .insertContent([
          {
            type: "workspaceLink",
            attrs: { kind: props.kind, refId: props.id, label: props.title || "Untitled" },
          },
          { type: "text", text: " " },
        ])
        .run();
    },
    items: async ({ query }: { query: string }) => {
      if (!query.trim()) return [];
      const results = await searchOntology(query);
      return results.filter((r) => TAB_KINDS.has(r.kind)).slice(0, 8);
    },
    render: () => {
      let component: ReactRenderer<MentionMenuRef, { items: SearchResult[]; command: (item: SearchResult) => void }>;
      let popup: HTMLDivElement | null = null;

      const position = (props: { clientRect?: (() => DOMRect | null) | null }) => {
        if (!popup) return;
        const rect = props.clientRect?.();
        if (!rect) return;
        const menuWidth = popup.offsetWidth || 240;
        const maxLeft = window.innerWidth - menuWidth - 8;
        const left = Math.max(8, Math.min(rect.left + window.scrollX, maxLeft + window.scrollX));
        popup.style.left = `${left}px`;
        popup.style.top = `${rect.bottom + window.scrollY + 6}px`;
      };

      return {
        onStart: (props) => {
          component = new ReactRenderer(MentionMenu, {
            props: { items: props.items as SearchResult[], command: props.command },
            editor: props.editor,
          });
          popup = document.createElement("div");
          popup.className = "slash-popup";
          popup.appendChild(component.element);
          document.body.appendChild(popup);
          position(props);
        },
        onUpdate(props) {
          component.updateProps({ items: props.items as SearchResult[], command: props.command });
          position(props);
        },
        onKeyDown(props) {
          if (props.event.key === "Escape") {
            popup?.remove();
            popup = null;
            return true;
          }
          return component.ref?.onKeyDown(props) ?? false;
        },
        onExit() {
          popup?.remove();
          popup = null;
          component.destroy();
        },
      };
    },
  });
}

export const WorkspaceMention = Extension.create({
  name: "workspaceMention",

  addProseMirrorPlugins() {
    return [
      buildLinkSuggestion(this.editor, "@", new PluginKey("workspaceMention")),
      buildLinkSuggestion(this.editor, "[[", new PluginKey("workspaceWikilink")),
    ];
  },
});
