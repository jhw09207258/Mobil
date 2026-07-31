"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force";
import { getRepositoryGraph, type RepositoryGraphNode, type RepositoryGraphEdge } from "./actions";
import { useWorkspace, type TabKind } from "../workspace/workspace-context";
import { IconDocuments, IconCode, IconSheet, IconMindmap, IconFiles, IconCalendar } from "../icons";

type SimNode = SimulationNodeDatum & RepositoryGraphNode;
type SimLink = { source: string; target: string; kind: "contain" | "ref" };

const KIND_ICON: Record<string, (p: { size?: number }) => React.ReactElement> = {
  document: IconDocuments,
  code: IconCode,
  sheet: IconSheet,
  mindmap: IconMindmap,
  file: IconFiles,
  event: IconCalendar,
};
const OPENABLE = new Set<TabKind>(["document", "code", "sheet", "mindmap"]);
const NODE_R: Record<string, number> = { folder: 14, event: 9 };
const DEFAULT_R = 11;

/**
 * 저장소 하나를 힘-기반(force-directed) 그래프로 그린다(Obsidian 의 Graph
 * view 와 같은 개념). SVG 로 직접 그린다 — 노드 수가 수백을 넘길 만한
 * 자료구조가 아니라(개인/팀 저장소 하나의 내용물) Canvas 최적화가 필요할
 * 정도는 아니고, 클릭·드래그를 노드 단위 이벤트로 다루기엔 SVG 가 더
 * 단순하다.
 */
export function RepositoryGraph({
  repositoryId,
  onNavigateFolder,
  onOpenFile,
}: {
  repositoryId: string;
  onNavigateFolder: (id: string) => void;
  onOpenFile: (id: string) => void;
}) {
  const router = useRouter();
  const { openTab } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [links, setLinks] = useState<SimLink[]>([]);
  const [tick, setTick] = useState(0);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<{ id: string; moved: boolean } | null>(null);
  const [size, setSize] = useState({ w: 800, h: 480 });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getRepositoryGraph(repositoryId).then((g) => {
      if (cancelled) return;
      const simNodes: SimNode[] = g.nodes.map((n) => ({ ...n }));
      const idOf = (kind: string, id: string) => `${kind}:${id}`;
      const known = new Set(simNodes.map((n) => idOf(n.kind, n.id)));
      const containLinks: SimLink[] = simNodes
        .filter((n) => n.containerId)
        .map((n) => ({ source: idOf("folder", n.containerId as string), target: idOf(n.kind, n.id), kind: "contain" as const }))
        .filter((l) => known.has(l.source) && known.has(l.target));
      const refLinks: SimLink[] = g.edges
        .map((e: RepositoryGraphEdge) => ({ source: idOf(e.aKind, e.aId), target: idOf(e.bKind, e.bId), kind: "ref" as const }))
        .filter((l) => known.has(l.source) && known.has(l.target));
      setNodes(simNodes);
      setLinks([...containLinks, ...refLinks]);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [repositoryId]);

  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (nodes.length === 0) return;
    const nodeKey = (n: SimNode) => `${n.kind}:${n.id}`;
    const byKey = new Map(nodes.map((n) => [nodeKey(n), n]));
    const simLinks = links
      .map((l) => ({ source: byKey.get(l.source), target: byKey.get(l.target), kind: l.kind }))
      .filter((l): l is { source: SimNode; target: SimNode; kind: "contain" | "ref" } => !!l.source && !!l.target);

    const sim = forceSimulation<SimNode>(nodes)
      .force(
        "link",
        forceLink(simLinks as unknown as { source: SimNode; target: SimNode }[])
          .id((d) => nodeKey(d as SimNode))
          .distance((l) => ((l as unknown as { kind: string }).kind === "contain" ? 60 : 110))
          .strength((l) => ((l as unknown as { kind: string }).kind === "contain" ? 0.7 : 0.25))
      )
      .force("charge", forceManyBody().strength(-160))
      .force("center", forceCenter(size.w / 2, size.h / 2))
      .force("collide", forceCollide().radius((d) => (NODE_R[(d as SimNode).kind] ?? DEFAULT_R) + 24))
      .on("tick", () => setTick((t) => t + 1));

    simRef.current = sim;
    return () => {
      sim.stop();
      simRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links, size.w, size.h]);

  const drawLinks = useMemo(() => {
    void tick;
    const byKey = new Map(nodes.map((n) => [`${n.kind}:${n.id}`, n]));
    return links
      .map((l) => ({ a: byKey.get(l.source), b: byKey.get(l.target), kind: l.kind }))
      .filter((l): l is { a: SimNode; b: SimNode; kind: "contain" | "ref" } => !!l.a && !!l.b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, links]);

  const onPointerDown = (n: SimNode) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragging.current = { id: `${n.kind}:${n.id}`, moved: false };
    n.fx = n.x;
    n.fy = n.y;
    simRef.current?.alphaTarget(0.3).restart();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const n = nodes.find((x) => `${x.kind}:${x.id}` === dragging.current!.id);
    if (!n) return;
    dragging.current.moved = true;
    n.fx = e.clientX - rect.left;
    n.fy = e.clientY - rect.top;
    setTick((t) => t + 1);
  };
  const onPointerUp = (n: SimNode) => (e: React.PointerEvent) => {
    (e.target as Element).releasePointerCapture(e.pointerId);
    const wasDrag = dragging.current?.moved;
    n.fx = null;
    n.fy = null;
    simRef.current?.alphaTarget(0);
    dragging.current = null;
    if (!wasDrag) navigate(n);
  };

  const navigate = (n: SimNode) => {
    if (n.kind === "folder") onNavigateFolder(n.id);
    else if (n.kind === "file") onOpenFile(n.id);
    else if (n.kind === "event") router.push(`/calendar?event=${n.id}`);
    else if (OPENABLE.has(n.kind as TabKind)) openTab(n.kind as TabKind, n.id, n.label);
  };

  if (loading) {
    return <div className="empty" style={{ padding: 40 }}>Loading graph…</div>;
  }
  if (nodes.length === 0) {
    return (
      <div className="empty" style={{ padding: 40 }}>
        Nothing here yet — the graph fills in as you add folders, items and
        references inside this repository.
      </div>
    );
  }

  return (
    <div className="repo-graph-wrap">
      <svg
        ref={svgRef}
        className="repo-graph-svg"
        viewBox={`0 0 ${size.w} ${size.h}`}
        onPointerMove={onPointerMove}
      >
        {drawLinks.map((l, i) => (
          <line
            key={i}
            x1={l.a.x}
            y1={l.a.y}
            x2={l.b.x}
            y2={l.b.y}
            className={l.kind === "contain" ? "repo-graph-edge-contain" : "repo-graph-edge-ref"}
          />
        ))}
        {nodes.map((n) => {
          const Icon = KIND_ICON[n.kind];
          const r = NODE_R[n.kind] ?? DEFAULT_R;
          return (
            <g
              key={`${n.kind}:${n.id}`}
              transform={`translate(${n.x ?? 0}, ${n.y ?? 0})`}
              className={`repo-graph-node repo-graph-node-${n.kind}`}
              onPointerDown={onPointerDown(n)}
              onPointerUp={onPointerUp(n)}
            >
              <circle r={r} />
              {Icon && (
                <foreignObject x={-7} y={-7} width={14} height={14} style={{ pointerEvents: "none" }}>
                  <div className="repo-graph-node-icon">
                    <Icon size={12} />
                  </div>
                </foreignObject>
              )}
              <text y={r + 13} textAnchor="middle">
                {n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label}
              </text>
              <title>{n.label}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
