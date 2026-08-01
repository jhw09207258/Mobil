import type { Json } from "@/lib/database.types";

// "#단어" — 유니코드 문자/숫자/밑줄 1~40자 조각을 "/" 로 최대 5단(부모 포함)
// 까지 이어 붙일 수 있다("#parent/child/grandchild") — Obsidian 의 중첩 태그와
// 같은 단순 표기다. MediaWiki/Logseq 처럼 태그끼리 별도의 포함 관계를 선언하는
// 구조는 아니다 — "/" 로 적은 경로 그 자체가 계층이다. 공백/구두점은 태그에
// 포함하지 않는다.
const TAG_RE = /#([\p{L}\p{N}_]{1,40}(?:\/[\p{L}\p{N}_]{1,40}){0,4})/gu;

/** 임의 텍스트에서 "#word" 토큰을 뽑아 소문자로 정규화한다(중복 제거). */
export function extractTagsFromText(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(TAG_RE)) {
    out.add(m[1].toLowerCase());
  }
  return [...out];
}

/** Tiptap JSON 문서의 모든 텍스트 노드를 이어붙인다(태그 추출용). */
export function extractTiptapPlainText(content: Json): string {
  const parts: string[] = [];

  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (n.type === "text" && typeof n.text === "string") parts.push(n.text);
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child);
    }
  }

  walk(content);
  return parts.join(" ");
}

type LegacyGraphNode = { data?: { label?: string; title?: string } };
type MindElixirTreeNode = { topic?: string; note?: string; children?: MindElixirTreeNode[] };

/** 마인드맵 노드 라벨(제목 텍스트)을 이어붙인다(태그 추출용, best-effort).
 * Mind Elixir 트리 형식(nodeData.children)이 현재 저장 포맷이고, React Flow
 * 시절의 구형 {nodes,edges} 그래프도 아직 열릴 수 있으니 둘 다 지원한다. */
export function extractMindmapPlainText(data: Json): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  const parts: string[] = [];

  const nodeData = (data as { nodeData?: MindElixirTreeNode }).nodeData;
  if (nodeData && typeof nodeData === "object") {
    const walk = (n: MindElixirTreeNode) => {
      if (typeof n.topic === "string") parts.push(n.topic);
      if (typeof n.note === "string") parts.push(n.note);
      for (const child of n.children ?? []) walk(child);
    };
    walk(nodeData);
    return parts.join(" ");
  }

  const legacyNodes = (data as { nodes?: LegacyGraphNode[] }).nodes;
  if (Array.isArray(legacyNodes)) {
    for (const n of legacyNodes) {
      if (!n || typeof n !== "object") continue;
      if (typeof n.data?.label === "string") parts.push(n.data.label);
      if (typeof n.data?.title === "string") parts.push(n.data.title);
    }
  }
  return parts.join(" ");
}
