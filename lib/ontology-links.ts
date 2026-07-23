import type { Json } from "@/lib/database.types";

export type LinkTarget = { to_kind: string; to_id: string };

const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const INTERNAL_LINK_RE = new RegExp(
  `/(documents|code|sheets|mindmap)/(${UUID_RE})`,
  "i"
);
const ROUTE_TO_KIND: Record<string, string> = {
  documents: "document",
  code: "code",
  sheets: "sheet",
  mindmap: "mindmap",
};

function dedupe(links: LinkTarget[]): LinkTarget[] {
  const seen = new Set<string>();
  const out: LinkTarget[] = [];
  for (const l of links) {
    const key = `${l.to_kind}:${l.to_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

type MindElixirRefNode = {
  metadata?: { kind?: string; refId?: string };
  children?: MindElixirRefNode[];
};

const REF_KINDS = new Set(["file", "code", "document", "sheet", "mindmap"]);

/**
 * 마인드맵에서 참조 노드(ref)를 링크 대상으로 추출한다. 이 마인드맵이
 * "포함"하는 오브젝트 목록으로 취급 — 참조 노드 간 개별 간선까지는 1차
 * 버전에서 다루지 않는다(마인드맵을 허브로 하는 단순 모델).
 *
 * lib/tags.ts 의 extractMindmapPlainText 와 마찬가지로 현재 저장 포맷
 * (nodeData 트리, metadata.kind/refId)과 구형 React Flow 그래프
 * ({nodes,edges}, type:"ref") 를 모두 지원한다.
 */
export function extractMindmapLinks(data: Json): LinkTarget[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];

  const nodeData = (data as { nodeData?: MindElixirRefNode }).nodeData;
  if (nodeData && typeof nodeData === "object") {
    const links: LinkTarget[] = [];
    const walk = (n: MindElixirRefNode) => {
      const kind = n.metadata?.kind;
      const refId = n.metadata?.refId;
      if (kind && REF_KINDS.has(kind) && refId) links.push({ to_kind: kind, to_id: refId });
      for (const child of n.children ?? []) walk(child);
    };
    walk(nodeData);
    return dedupe(links);
  }

  const nodes = (data as { nodes?: unknown[] }).nodes;
  if (!Array.isArray(nodes)) return [];

  const links: LinkTarget[] = [];
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    const node = n as { type?: string; data?: { kind?: string; refId?: string } };
    if (node.type !== "ref") continue;
    const kind = node.data?.kind;
    const refId = node.data?.refId;
    if (!kind || !refId) continue;
    links.push({ to_kind: kind, to_id: refId });
  }
  return dedupe(links);
}

/**
 * Tiptap 문서 JSON에서 다른 Mobil 항목을 가리키는 링크 마크(href)를 찾는다.
 * 에디터의 링크 버튼으로 /documents/{id}, /code/{id}, /sheets/{id},
 * /mindmap/{id} 형태의 내부 URL을 걸었을 때만 인식한다.
 */
export function extractDocLinks(content: Json): LinkTarget[] {
  const links: LinkTarget[] = [];

  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const n = node as { marks?: unknown[]; content?: unknown[] };
    if (Array.isArray(n.marks)) {
      for (const mark of n.marks) {
        if (!mark || typeof mark !== "object") continue;
        const m = mark as { type?: string; attrs?: { href?: string } };
        if (m.type !== "link" || !m.attrs?.href) continue;
        const match = m.attrs.href.match(INTERNAL_LINK_RE);
        if (!match) continue;
        const kind = ROUTE_TO_KIND[match[1].toLowerCase()];
        if (kind) links.push({ to_kind: kind, to_id: match[2].toLowerCase() });
      }
    }
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child);
    }
  }

  walk(content);
  return dedupe(links);
}
