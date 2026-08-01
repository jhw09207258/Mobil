// SNA(사회연결망분석) 알고리즘 검증. 실행: node lib/graph-sna.test.mjs
import assert from "node:assert";
import { brandesBetweenness, louvainCommunities } from "./graph-sna.ts";

// ---------------------------------------------------------------- Brandes
// 다리(bridge) 그래프: a-b-c-d-e, c 가 유일한 다리 노드라 매개 중심성이
// 가장 커야 한다.
{
  const nodes = ["a", "b", "c", "d", "e"];
  const edges = [
    { a: "a", b: "b" },
    { a: "b", b: "c" },
    { a: "c", b: "d" },
    { a: "d", b: "e" },
  ];
  const C = brandesBetweenness(nodes, edges);
  assert.ok(C.get("c") > C.get("b"), "가운데 노드가 곁가지보다 중심성이 커야 함");
  assert.ok(C.get("b") > C.get("a"), "다리에 가까울수록 중심성이 커야 함");
  assert.equal(C.get("a"), 0, "말단 노드는 중심성 0");
  assert.equal(C.get("e"), 0, "말단 노드는 중심성 0");
}

// 별(star) 그래프: 중심 허브의 중심성이 압도적으로 커야 한다.
{
  const nodes = ["hub", "1", "2", "3", "4"];
  const edges = ["1", "2", "3", "4"].map((leaf) => ({ a: "hub", b: leaf }));
  const C = brandesBetweenness(nodes, edges);
  for (const leaf of ["1", "2", "3", "4"]) {
    assert.ok(C.get("hub") > C.get(leaf), `허브가 ${leaf} 보다 중심성이 커야 함`);
    assert.equal(C.get(leaf), 0);
  }
}

// 완전 그래프(모든 쌍이 직접 연결) — 최단 경로에 중간 노드가 끼지 않으므로
// 모든 노드의 중심성이 0.
{
  const nodes = ["a", "b", "c", "d"];
  const edges = [];
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) edges.push({ a: nodes[i], b: nodes[j] });
  const C = brandesBetweenness(nodes, edges);
  for (const id of nodes) assert.equal(C.get(id), 0);
}

// 고립 노드(간선 없음) — 에러 없이 0을 돌려줘야 한다.
{
  const C = brandesBetweenness(["solo"], []);
  assert.equal(C.get("solo"), 0);
}

// ---------------------------------------------------------------- Louvain
// 두 덩어리가 약한 다리 하나로만 이어진 그래프 — 같은 덩어리끼리는 같은
// 커뮤니티, 서로 다른 덩어리는 다른 커뮤니티로 갈라져야 한다.
{
  const nodes = ["a1", "a2", "a3", "b1", "b2", "b3"];
  const edges = [
    { a: "a1", b: "a2" },
    { a: "a2", b: "a3" },
    { a: "a1", b: "a3" },
    { a: "b1", b: "b2" },
    { a: "b2", b: "b3" },
    { a: "b1", b: "b3" },
    { a: "a1", b: "b1" }, // 두 삼각형을 잇는 유일한 다리
  ];
  const communities = louvainCommunities(nodes, edges);
  assert.equal(communities.get("a1"), communities.get("a2"));
  assert.equal(communities.get("a1"), communities.get("a3"));
  assert.equal(communities.get("b1"), communities.get("b2"));
  assert.equal(communities.get("b1"), communities.get("b3"));
  assert.notEqual(communities.get("a1"), communities.get("b1"), "두 삼각형은 서로 다른 커뮤니티여야 함");
}

// 간선이 전혀 없으면 모두 커뮤니티 0.
{
  const communities = louvainCommunities(["x", "y", "z"], []);
  assert.equal(communities.get("x"), 0);
  assert.equal(communities.get("y"), 0);
  assert.equal(communities.get("z"), 0);
}

console.log("lib/graph-sna.test.mjs: all checks passed");
