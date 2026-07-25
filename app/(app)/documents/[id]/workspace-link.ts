import { Node, mergeAttributes } from "@tiptap/core";

// @ 로 삽입하는 워크스페이스 항목 참조 칩 — 문서/코드/시트/맵으로 연결된다.
// 편집 불가능한 원자(atom) 인라인 노드로, 클릭은 editor.tsx 의 클릭
// 핸들러가 data-workspace-link 속성을 보고 처리한다(NodeView 없이 가볍게).
export const WorkspaceLink = Node.create({
  name: "workspaceLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      kind: { default: null },
      refId: { default: null },
      label: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-workspace-link]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-workspace-link": "",
        "data-kind": node.attrs.kind,
        "data-ref-id": node.attrs.refId,
        class: "doc-ref-chip",
        contenteditable: "false",
      }),
      `${node.attrs.label}`,
    ];
  },
});
