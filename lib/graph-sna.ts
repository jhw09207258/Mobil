// ============================================================================
// 저장소 그래프(Repository Graph)의 사회연결망분석(SNA) 지표 — 순수 함수,
// UI(repository-graph.tsx)와 분리해 독립적으로 테스트한다.
// ============================================================================

export type GraphEdge = { a: string; b: string };

/**
 * Brandes 알고리즘 — 매개 중심성(betweenness centrality). 각 노드가 다른
 * 노드 쌍 사이의 최단 경로 위에 몇 번이나 놓이는지를 센다. 가중치 없는
 * 무방향 그래프 기준(BFS 기반) — O(V·E). 값이 클수록 그래프에서 서로 다른
 * 영역을 잇는 "다리" 역할을 하는 노드다.
 */
export function brandesBetweenness(
  nodeIds: string[],
  edges: GraphEdge[]
): Map<string, number> {
  const adj = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  for (const { a, b } of edges) {
    if (a === b || !adj.has(a) || !adj.has(b)) continue;
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }

  const C = new Map<string, number>(nodeIds.map((id) => [id, 0]));

  for (const s of nodeIds) {
    const S: string[] = [];
    const P = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
    const sigma = new Map<string, number>(nodeIds.map((id) => [id, 0]));
    const d = new Map<string, number>(nodeIds.map((id) => [id, -1]));
    sigma.set(s, 1);
    d.set(s, 0);

    const Q: string[] = [s];
    let qi = 0;
    while (qi < Q.length) {
      const v = Q[qi++];
      S.push(v);
      for (const w of adj.get(v) ?? []) {
        if (d.get(w)! < 0) {
          Q.push(w);
          d.set(w, d.get(v)! + 1);
        }
        if (d.get(w) === d.get(v)! + 1) {
          sigma.set(w, sigma.get(w)! + sigma.get(v)!);
          P.get(w)!.push(v);
        }
      }
    }

    const delta = new Map<string, number>(nodeIds.map((id) => [id, 0]));
    while (S.length) {
      const w = S.pop()!;
      for (const v of P.get(w)!) {
        delta.set(v, delta.get(v)! + (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!));
      }
      if (w !== s) C.set(w, C.get(w)! + delta.get(w)!);
    }
  }

  // 무방향 그래프 — 각 쌍이 두 번(양쪽에서 한 번씩) 세어졌으므로 절반으로.
  for (const id of nodeIds) C.set(id, C.get(id)! / 2);
  return C;
}

/**
 * Louvain 방법(1단계 — local moving phase) — 모듈성(modularity) 이득이
 * 최대가 되는 이웃 커뮤니티로 각 노드를 옮기는 것을 더 옮길 곳이 없을
 * 때까지 반복한다. 그래프 규모(저장소 하나 분량, 수십~수백 노드)를 감안해
 * 커뮤니티를 압축해 그래프를 다시 만드는 상위 단계(재귀적 응집)까지는
 * 가지 않고 1단계만으로 충분한 군집을 얻는다.
 * ΔQ = k_i,in/m − (Σtot(C)·k_i)/(2m²) — 표준 모듈성 이득 공식.
 */
export function louvainCommunities(
  nodeIds: string[],
  edges: GraphEdge[]
): Map<string, number> {
  const idx = new Map(nodeIds.map((id, i) => [id, i]));
  const n = nodeIds.length;
  const adj: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  const degree = new Array<number>(n).fill(0);
  let m2 = 0;

  for (const { a, b } of edges) {
    const ai = idx.get(a);
    const bi = idx.get(b);
    if (ai == null || bi == null || ai === bi) continue;
    adj[ai].set(bi, (adj[ai].get(bi) ?? 0) + 1);
    adj[bi].set(ai, (adj[bi].get(ai) ?? 0) + 1);
    degree[ai]++;
    degree[bi]++;
    m2 += 2;
  }

  const community = nodeIds.map((_, i) => i);
  if (m2 === 0) return new Map(nodeIds.map((id) => [id, 0]));
  const sigmaTot = degree.slice();

  let improved = true;
  let pass = 0;
  while (improved && pass < 30) {
    improved = false;
    pass++;
    for (let i = 0; i < n; i++) {
      const ci = community[i];
      sigmaTot[ci] -= degree[i];

      const commWeights = new Map<number, number>();
      for (const [j, w] of adj[i]) {
        const cj = community[j];
        commWeights.set(cj, (commWeights.get(cj) ?? 0) + w);
      }

      let bestC = ci;
      let bestGain = (commWeights.get(ci) ?? 0) - (sigmaTot[ci] * degree[i]) / m2;
      for (const [cj, kIn] of commWeights) {
        if (cj === ci) continue;
        const gain = kIn - (sigmaTot[cj] * degree[i]) / m2;
        if (gain > bestGain) {
          bestGain = gain;
          bestC = cj;
        }
      }

      sigmaTot[bestC] += degree[i];
      if (bestC !== ci) {
        community[i] = bestC;
        improved = true;
      }
    }
  }

  const remap = new Map<number, number>();
  let next = 0;
  const result = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const c = community[i];
    if (!remap.has(c)) remap.set(c, next++);
    result.set(nodeIds[i], remap.get(c)!);
  }
  return result;
}
