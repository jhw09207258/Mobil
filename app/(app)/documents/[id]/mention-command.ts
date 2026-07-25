import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import { MentionMenu, type MentionMenuRef } from "./mention-menu";
import { searchOntology, type SearchResult } from "../../search/actions";

// @ 로 다른 워크스페이스 항목(문서/코드/시트/맵)을 검색해 링크 칩으로
// 삽입한다. 위치/키보드 처리는 slash-command.ts 와 동일한 패턴.
const TAB_KINDS = new Set(["document", "code", "sheet", "mindmap"]);

// Suggestion 은 pluginKey 를 주지 않으면 전부 공용 기본 키(suggestion)를 쓴다.
// 그러면 같은 에디터에 붙는 두 번째 Suggestion(여기 @ 멘션 + slash-command 의 /)
// 에서 ProseMirror 가 "Adding different instances of a keyed plugin
// (suggestion$)" 로 죽어 에디터 전체가 뜨지 않는다 — 반드시 서로 다른 키를 준다.
const mentionPluginKey = new PluginKey("workspaceMention");

export const WorkspaceMention = Extension.create({
  name: "workspaceMention",

  addProseMirrorPlugins() {
    return [
      Suggestion<SearchResult, SearchResult>({
        editor: this.editor,
        pluginKey: mentionPluginKey,
        char: "@",
        startOfLine: false,
        command: ({ editor, range, props }) => {
          editor
            .chain()
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
      }),
    ];
  },
});
