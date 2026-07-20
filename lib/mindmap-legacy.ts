import type { MindElixirData, NodeObj } from "mind-elixir";
import type { Json } from "@/lib/database.types";

// ============================================================================
// 마인드맵 데이터 형식 판별 + 레거시(React Flow 시절) nodes/edges 그래프 →
// Mind Elixir 트리 변환. 클라이언트(canvas.tsx)와 서버 액션(convert-actions.ts)
// 양쪽에서 같은 정규화 로직이 필요해 공용 모듈로 둔다 — 서버 쪽이 이 정규화
// 없이 isMindElixirData 만 검사하면, 아직 마인드맵을 한 번도 재저장하지 않은
// (그래서 레거시 형식 그대로인) 맵을 열람 전용 사용자가 변환하려 할 때
// "변환할 내용 없음" 오류로 잘못 막힌다 — 캔버스 자체는 같은 데이터를
// convertLegacyGraph 로 정상 렌더링하는데도.
// ============================================================================

export type RefKind = "file" | "code" | "document";
export type NodeMeta = { kind: "note" } | { kind: RefKind; refId: string };

type LegacyNode = { id: string; type?: string; data?: { kind?: string; label?: string; refId?: string } };
type LegacyEdge = { id: string; source: string; target: string };

export function isMindElixirData(data: unknown): data is MindElixirData {
  return !!data && typeof data === "object" && "nodeData" in (data as Record<string, unknown>);
}

function legacyNodeToObj(n: LegacyNode): NodeObj {
  const d = n.data ?? {};
  if (n.type === "ref") {
    return {
      id: n.id,
      topic: `[${d.kind}] ${d.label ?? ""}`,
      metadata: { kind: d.kind, refId: d.refId } as NodeMeta,
    };
  }
  return { id: n.id, topic: d.label || "Note", metadata: { kind: "note" } as NodeMeta };
}

// 자유 배치 그래프는 트리가 아닐 수 있으므로: 들어오는 간선이 없는 노드를
// 루트의 자식으로, BFS 로 도달한 간선만 트리 간선으로 채택하고, 남는 간선은
// arrow(화살표)로, 고립/사이클 노드는 루트에 그대로 매단다.
export function convertLegacyGraph(
  nodes: LegacyNode[],
  edges: LegacyEdge[],
  fallbackTitle: string
): MindElixirData {
  const children = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const n of nodes) {
    incoming.set(n.id, 0);
    children.set(n.id, []);
  }
  for (const e of edges) {
    if (!children.has(e.source) || !incoming.has(e.target)) continue;
    children.get(e.source)!.push(e.target);
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const treeEdges = new Set<string>();
  const buildTree = (id: string): NodeObj => {
    visited.add(id);
    const obj = legacyNodeToObj(byId.get(id)!);
    const kids = (children.get(id) ?? []).filter((c) => !visited.has(c));
    if (kids.length > 0) {
      obj.children = kids.map((c) => {
        treeEdges.add(`${id}->${c}`);
        return buildTree(c);
      });
    }
    return obj;
  };

  let roots = nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0).map((n) => n.id);
  if (roots.length === 0 && nodes.length > 0) roots = [nodes[0].id];

  const rootChildren = roots.filter((id) => !visited.has(id)).map(buildTree);
  const leftover = nodes.filter((n) => !visited.has(n.id)).map((n) => buildTree(n.id));

  const nodeData: NodeObj = {
    id: "root",
    topic: fallbackTitle || "Untitled map",
    children: [...rootChildren, ...leftover],
  };

  const arrows = edges
    .filter((e) => !treeEdges.has(`${e.source}->${e.target}`))
    .map((e) => ({ id: e.id, label: "", from: e.source, to: e.target }));

  return { nodeData, arrows };
}

export function parseInitialData(data: Json, fallbackTitle: string): MindElixirData {
  if (isMindElixirData(data)) return data as MindElixirData;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const o = data as { nodes?: LegacyNode[]; edges?: LegacyEdge[] };
    if (Array.isArray(o.nodes)) {
      return convertLegacyGraph(o.nodes, Array.isArray(o.edges) ? o.edges : [], fallbackTitle);
    }
  }
  return { nodeData: { id: "root", topic: fallbackTitle || "Untitled map", children: [] } };
}
