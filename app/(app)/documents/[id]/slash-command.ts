import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import { SlashMenu, type SlashItem, type SlashMenuRef } from "./slash-menu";

// Notion 류 "/" 명령 메뉴. tippy.js 등 포지셔닝 라이브러리 없이 ProseMirror
// 좌표(coordsAtPos)를 직접 읽어 고정 위치 팝업을 붙인다.
const COMMANDS: SlashItem[] = [
  {
    title: "Text",
    desc: "Plain paragraph",
    icon: "¶",
    run: (editor, range) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    title: "Heading 1",
    desc: "Large section heading",
    icon: "H1",
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run(),
  },
  {
    title: "Heading 2",
    desc: "Medium section heading",
    icon: "H2",
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run(),
  },
  {
    title: "Heading 3",
    desc: "Small section heading",
    icon: "H3",
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run(),
  },
  {
    title: "Bullet list",
    desc: "Simple unordered list",
    icon: "•",
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: "Numbered list",
    desc: "List with numbering",
    icon: "1.",
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: "Checklist",
    desc: "Track tasks with checkboxes",
    icon: "☑",
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: "Table",
    desc: "Insert a 3×3 table",
    icon: "▦",
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    title: "Quote",
    desc: "Capture a quote",
    icon: "❝",
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: "Code block",
    desc: "Multi-line code snippet",
    icon: "{ }",
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: "Divider",
    desc: "Horizontal rule",
    icon: "―",
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];

export const SlashCommand = Extension.create({
  name: "slashCommand",

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: "/",
        startOfLine: false,
        command: ({ editor, range, props }) => {
          props.run(editor, range);
        },
        items: ({ query }: { query: string }) =>
          COMMANDS.filter((c) => c.title.toLowerCase().includes(query.toLowerCase())).slice(0, 10),
        render: () => {
          let component: ReactRenderer<SlashMenuRef, { items: SlashItem[]; command: (item: SlashItem) => void }>;
          let popup: HTMLDivElement | null = null;

          const position = (props: { clientRect?: (() => DOMRect | null) | null }) => {
            if (!popup) return;
            const rect = props.clientRect?.();
            if (!rect) return;
            // 메뉴 폭(작은 화면에선 css 로 100vw-32px 까지 줄어듦)만큼 오른쪽 여백을
            // 확보해 화면 밖으로 나가지 않게 좌표를 clamp 한다.
            const menuWidth = popup.offsetWidth || 240;
            const maxLeft = window.innerWidth - menuWidth - 8;
            const left = Math.max(8, Math.min(rect.left + window.scrollX, maxLeft + window.scrollX));
            popup.style.left = `${left}px`;
            popup.style.top = `${rect.bottom + window.scrollY + 6}px`;
          };

          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashMenu, {
                props: { items: props.items as SlashItem[], command: props.command },
                editor: props.editor,
              });
              popup = document.createElement("div");
              popup.className = "slash-popup";
              popup.appendChild(component.element);
              document.body.appendChild(popup);
              position(props);
            },
            onUpdate(props) {
              component.updateProps({ items: props.items as SlashItem[], command: props.command });
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
