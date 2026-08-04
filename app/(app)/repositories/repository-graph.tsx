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
import { brandesBetweenness, louvainCommunities } from "@/lib/graph-sna";
import { IconDocuments, IconCode, IconSheet, IconMindmap, IconFiles, IconCalendar, IconRefresh } from "../icons";

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
const MAX_CENTRALITY_BOOST = 7;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 4;
// 탭(터치)은 손가락이 미세하게 떨려도 pointermove 가 최소 한 번은 온다 —
// 문턱값 없이 "움직이면 곧 드래그"로 보면 모바일에서 노드를 절대 열 수
// 없다. 이 거리(px) 안의 움직임은 여전히 탭으로 본다.
const DRAG_THRESHOLD = 4;

// 커뮤니티(Louvain) 팔레트 — dataviz 스킬의 검증된 인접-쌍 CVD 안전 팔레트와
// 같은 톤(storage-chart.tsx 와 동일 계열)을 재사용해 앱 전체 색 언어를 맞춘다.
const COMMUNITY_PALETTE = [
  "#7c9cd0",
  "#83b692",
  "#c08bbe",
  "#d9b36a",
  "#7fb8ae",
  "#d89a84",
];

type Transform = { x: number; y: number; k: number };

/**
 * 저장소 하나를 힘-기반(force-directed) 그래프로 그린다(Obsidian 의 Graph
 * view 와 같은 개념). SVG 로 직접 그린다 — 노드 수가 수백을 넘길 만한
 * 자료구조가 아니라(개인/팀 저장소 하나의 내용물) Canvas 최적화가 필요할
 * 정도는 아니고, 클릭·드래그를 노드 단위 이벤트로 다루기엔 SVG 가 더
 * 단순하다.
 *
 * SNA(사회연결망분석) 두 지표를 시각적으로 얹는다 — 노드 반지름은 Brandes
 * 매개 중심성(그래프에서 다른 영역을 잇는 "다리" 역할일수록 큼), 테두리
 * 색은 Louvain 커뮤니티(서로 촘촘히 엮인 군집일수록 같은 색)로 인코딩한다.
 * 종류(문서/코드/…)는 기존처럼 아이콘 + 채우기색으로 구분한다.
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
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<{ id: string; moved: boolean; startX: number; startY: number } | null>(null);
  const panning = useRef<{ x: number; y: number; startTx: number; startTy: number } | null>(null);
  const pinch = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchDist = useRef<number | undefined>(undefined);
  const transformRef = useRef(transform);
  transformRef.current = transform;
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
      setTransform({ x: 0, y: 0, k: 1 });
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

  // ---- SNA: 매개 중심성(Brandes) + 커뮤니티(Louvain) — 노드/간선 집합이
  // 바뀔 때만(새 저장소를 열 때) 다시 계산한다, 시뮬레이션 tick 마다가 아니라.
  // useMemo(렌더 중 동기 계산)가 아니라 이펙트에서 계산한다 — 큰 저장소(노드
  // 수백 개)에서는 O(V·E) 계산이 몇십 ms 걸릴 수 있는데, 렌더를 막으면 그만큼
  // 그래프가 뜨는 게 늦어진다. 이펙트로 미루면 노드는 즉시(기본 반지름/색으로)
  // 그려지고, SNA 값은 계산되는 대로 곧이어 반영된다 — 화면이 먼저 반응한다.
  const [sna, setSna] = useState<{
    centrality: Map<string, number>;
    community: Map<string, number>;
    maxCentrality: number;
  }>({ centrality: new Map(), community: new Map(), maxCentrality: 0 });

  useEffect(() => {
    if (nodes.length === 0) return;
    const nodeIds = nodes.map((n) => `${n.kind}:${n.id}`);
    const edges = links.map((l) => ({ a: l.source, b: l.target }));
    const centrality = brandesBetweenness(nodeIds, edges);
    const community = louvainCommunities(nodeIds, edges);
    const maxCentrality = Math.max(0, ...Array.from(centrality.values()));
    setSna({ centrality, community, maxCentrality });
  }, [nodes, links]);

  const drawLinks = useMemo(() => {
    void tick;
    const byKey = new Map(nodes.map((n) => [`${n.kind}:${n.id}`, n]));
    return links
      .map((l) => ({ a: byKey.get(l.source), b: byKey.get(l.target), kind: l.kind }))
      .filter((l): l is { a: SimNode; b: SimNode; kind: "contain" | "ref" } => !!l.a && !!l.b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, links]);

  const toWorld = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const t = transformRef.current;
    return { x: (sx - t.x) / t.k, y: (sy - t.y) / t.k, sx, sy };
  };

  const onPointerDown = (n: SimNode) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragging.current = { id: `${n.kind}:${n.id}`, moved: false, startX: e.clientX, startY: e.clientY };
    n.fx = n.x;
    n.fy = n.y;
    simRef.current?.alphaTarget(0.3).restart();
  };

  const onSvgPointerDown = (e: React.PointerEvent) => {
    // 핀치(두 손가락) — 두 번째 포인터가 내려오면 팬은 멈추고 확대/축소로 전환.
    pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current.size >= 2) {
      panning.current = null;
      return;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    panning.current = { x: e.clientX, y: e.clientY, startTx: transform.x, startTy: transform.y };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pinch.current.has(e.pointerId)) pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch.current.size >= 2) {
      const [p1, p2] = Array.from(pinch.current.values());
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const prevDist = pinchDist.current;
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      if (prevDist && svgRef.current) {
        const rect = svgRef.current.getBoundingClientRect();
        const mx = mid.x - rect.left;
        const my = mid.y - rect.top;
        setTransform((t) => {
          const factor = dist / prevDist;
          const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, t.k * factor));
          const wx = (mx - t.x) / t.k;
          const wy = (my - t.y) / t.k;
          return { x: mx - wx * k, y: my - wy * k, k };
        });
      }
      pinchDist.current = dist;
      return;
    }

    if (dragging.current && svgRef.current) {
      const n = nodes.find((x) => `${x.kind}:${x.id}` === dragging.current!.id);
      if (!n) return;
      const dist = Math.hypot(e.clientX - dragging.current.startX, e.clientY - dragging.current.startY);
      if (dist > DRAG_THRESHOLD) dragging.current.moved = true;
      const world = toWorld(e.clientX, e.clientY);
      n.fx = world.x;
      n.fy = world.y;
      setTick((t) => t + 1);
      return;
    }

    if (panning.current) {
      const dx = e.clientX - panning.current.x;
      const dy = e.clientY - panning.current.y;
      setTransform((t) => ({ ...t, x: panning.current!.startTx + dx, y: panning.current!.startTy + dy }));
    }
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

  const onSvgPointerUp = (e: React.PointerEvent) => {
    pinch.current.delete(e.pointerId);
    if (pinch.current.size < 2) pinchDist.current = undefined;
    panning.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setTransform((t) => {
      const factor = Math.exp(-e.deltaY * 0.0012);
      const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, t.k * factor));
      const wx = (mx - t.x) / t.k;
      const wy = (my - t.y) / t.k;
      return { x: mx - wx * k, y: my - wy * k, k };
    });
  };

  // 트랙패드/브라우저의 기본 페이지 스크롤을 막아야 해서(React 의 합성
  // onWheel 은 패시브 리스너라 preventDefault 가 씹힌다) 네이티브로 붙인다.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const navigate = (n: SimNode) => {
    if (n.kind === "folder") onNavigateFolder(n.id);
    else if (n.kind === "file") onOpenFile(n.id);
    else if (n.kind === "event") router.push(`/calendar?event=${n.id}`);
    else if (OPENABLE.has(n.kind as TabKind)) openTab(n.kind as TabKind, n.id, n.label);
  };

  const resetView = () => setTransform({ x: 0, y: 0, k: 1 });

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
    <div className="repo-graph-shell">
      <div className="repo-graph-wrap">
        <button type="button" className="btn btn-sm btn-icon repo-graph-reset" onClick={resetView} title="Reset zoom & pan" aria-label="Reset zoom & pan">
          <IconRefresh size={13} />
        </button>
        <svg
          ref={svgRef}
          className="repo-graph-svg"
          viewBox={`0 0 ${size.w} ${size.h}`}
          onPointerDown={onSvgPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onSvgPointerUp}
          onPointerCancel={onSvgPointerUp}
          onWheel={onWheel}
        >
          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
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
              const key = `${n.kind}:${n.id}`;
              const baseR = NODE_R[n.kind] ?? DEFAULT_R;
              const centrality = sna.centrality.get(key) ?? 0;
              const boost = sna.maxCentrality > 0 ? Math.sqrt(centrality / sna.maxCentrality) * MAX_CENTRALITY_BOOST : 0;
              const r = baseR + boost;
              const communityId = sna.community.get(key) ?? 0;
              const ringColor = COMMUNITY_PALETTE[communityId % COMMUNITY_PALETTE.length];
              return (
                <g
                  key={key}
                  transform={`translate(${n.x ?? 0}, ${n.y ?? 0})`}
                  className={`repo-graph-node repo-graph-node-${n.kind}`}
                  onPointerDown={onPointerDown(n)}
                  onPointerUp={onPointerUp(n)}
                >
                  <circle r={r} style={{ stroke: ringColor }} />
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
          </g>
        </svg>
      </div>
      <p className="card-source repo-graph-caption">
        Node size · betweenness centrality (Brandes) — bigger nodes bridge more paths. Ring color · detected community (Louvain). Scroll or pinch to zoom, drag the background to pan.
      </p>
    </div>
  );
}
