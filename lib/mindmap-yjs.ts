import * as Y from "yjs";
import type { NodeObj } from "mind-elixir";

// ============================================================================
// 마인드맵 트리 ↔ Yjs 공유 구조 변환 (구조적 실시간 병합).
// ----------------------------------------------------------------------------
// mind-elixir 에는 y-prosemirror/y-codemirror.next 같은 공식 Yjs 바인딩이
// 없다. 매 조작마다 mind-elixir 가 내부적으로 발생시키는 라이브러리 특유의
// 이벤트(수십 종류: addChild/insertSibling/insertParent/reshapeNode/
// moveNodeIn/removeNodes/copyNode/... 및 화살표·요약·스타일 변경)를 일일이
// Yjs 오퍼레이션으로 옮기는 대신, 훨씬 단순하고 스스로 오차를 바로잡는
// 방식을 쓴다:
//
//   1. 노드 트리를 "평평한 테이블"(id -> {topic, parentId, order, ...나머지})
//      로 펼친다 — 각 노드가 한 항목인 flat Y.Map(id -> Y.Map(fields)).
//   2. 로컬에서 뭔가 바뀔 때마다(bus "operation" 이벤트) 현재 트리를 다시
//      펼쳐서 "직전에 동기화한 상태"와 비교(diff)해, 실제로 달라진 노드의
//      필드만 Yjs 에 쓰고 사라진 노드만 지운다. 어떤 조작이었는지는 몰라도
//      되고, 결과 트리만 알면 된다 — 그래서 라이브러리가 내부적으로 어떤
//      경로로 트리를 바꾸든(지금 안 다루는 조작 포함) 다음 diff 에서 그대로
//      반영된다.
//   3. flat 맵은 노드 단위(Y.Map)로 나뉘어 있어, 서로 다른 노드를 건드린
//      동시 편집은 Yjs 가 자동으로 합친다. 같은 노드의 같은 필드를 동시에
//      건드리면 필드 단위 last-writer-wins 이다(완전한 문자 단위 병합은
//      아님 — 이 한계는 알려진 트레이드오프로 문서화되어 있다).
//   4. 원격 변경을 반영할 때는 flat 맵 전체를 다시 트리로 재구성해
//      me.refresh() 로 반영한다.
// ============================================================================

export type FlatNode = {
  id: string;
  topic: string;
  parentId: string | null;
  order: number;
  /** id/topic/children/parent 를 제외한 나머지 NodeObj 필드(note, metadata,
   * style, tags, icons, image, branchColor 등) 전체를 통째로 보존한다 —
   * 개별 필드를 하나씩 나열하면 mind-elixir 가 지원하는 속성이 하나라도
   * 빠질 때 Yjs 왕복 중 조용히 유실된다. */
  rest: Record<string, unknown>;
};

export function flattenTree(root: NodeObj): Map<string, FlatNode> {
  const out = new Map<string, FlatNode>();
  const walk = (node: NodeObj, parentId: string | null, order: number) => {
    const { id, topic, children, parent: _parent, ...rest } = node as NodeObj & { parent?: unknown };
    out.set(id, { id, topic: topic ?? "", parentId, order, rest });
    (children ?? []).forEach((child, i) => walk(child, id, i));
  };
  walk(root, null, 0);
  return out;
}

function flatNodeEqual(a: FlatNode, b: FlatNode): boolean {
  return (
    a.topic === b.topic &&
    a.parentId === b.parentId &&
    a.order === b.order &&
    JSON.stringify(a.rest) === JSON.stringify(b.rest)
  );
}

/** prev(직전 동기화 상태) → next(지금 로컬 상태) 로 바뀐 부분만 Yjs 맵에
 * 반영한다. 안 바뀐 노드까지 매번 다시 쓰면 그 필드를 "방금 내가 썼다"고
 * 우기는 꼴이 되어, 동시편집 중 실제로는 아무도 안 건드린 부분에서까지
 * 상대방 변경을 밀어낼 여지가 생긴다. */
export function syncFlatToYMap(
  yNodes: Y.Map<Y.Map<unknown>>,
  prev: Map<string, FlatNode>,
  next: Map<string, FlatNode>
): void {
  for (const [id, n] of next) {
    const before = prev.get(id);
    if (before && flatNodeEqual(before, n)) continue;
    let yNode = yNodes.get(id);
    if (!yNode) {
      yNode = new Y.Map();
      yNodes.set(id, yNode);
    }
    if (!before || before.topic !== n.topic) yNode.set("topic", n.topic);
    if (!before || before.parentId !== n.parentId) yNode.set("parentId", n.parentId);
    if (!before || before.order !== n.order) yNode.set("order", n.order);
    if (!before || JSON.stringify(before.rest) !== JSON.stringify(n.rest)) yNode.set("rest", n.rest);
  }
  for (const id of prev.keys()) {
    if (!next.has(id)) yNodes.delete(id);
  }
}

export function readFlatFromYMap(yNodes: Y.Map<Y.Map<unknown>>): Map<string, FlatNode> {
  const out = new Map<string, FlatNode>();
  yNodes.forEach((yNode, id) => {
    out.set(id, {
      id,
      topic: (yNode.get("topic") as string) ?? "",
      parentId: (yNode.get("parentId") as string | null | undefined) ?? null,
      order: (yNode.get("order") as number) ?? 0,
      rest: (yNode.get("rest") as Record<string, unknown>) ?? {},
    });
  });
  return out;
}

/** flat 맵을 다시 트리로 재구성한다. parentId 가 null 인 노드가 루트다.
 * CRDT 병합 특성상 드물게 두 클라이언트가 동시에 "상위로 감싸기"를 실행하면
 * 루트 후보가 둘 이상 생길 수 있다 — id 사전순으로 하나를 결정적으로 골라
 * (모든 클라이언트가 같은 데이터를 보므로 같은 노드로 수렴한다) 나머지는
 * 그 루트의 자식으로 편입한다.
 *
 * 고아 처리(테스트로 검증한 실제 동작, 둘을 헷갈리면 안 된다):
 * - "다른 부모로 옮겨진 노드"의 새 부모가 하필 다른 클라이언트에 의해 동시에
 *   삭제된 경우 — 옮겨진 노드 자신의 항목은 삭제 대상이 아니었으므로 살아
 *   있고, parentId 만 존재하지 않는 id 를 가리키게 된다. 이런 진짜 고아는
 *   루트 밑에 편입해 유실을 막는다.
 * - 반대로 "어떤 하위 트리를 통째로 삭제"했는데 다른 클라이언트가 하필 그
 *   삭제된 하위 트리 *안의* 노드를 동시에 편집한 경우는 다르다 — 삭제한
 *   쪽의 diff 가 그 하위 트리 전체(자손 포함)를 flat 맵에서 지우므로, 편집은
 *   가해졌지만 대상 항목 자체가 사라져 복구되지 않는다("삭제가 이긴다").
 *   대부분의 협업 도구가 이 상황을 똑같이 처리한다(예: 문서에서 문단을
 *   지웠는데 그 문단 안 텍스트를 동시에 고친 경우 보통 삭제가 이긴다).
 */
export function reconstructTree(flat: Map<string, FlatNode>): NodeObj | null {
  if (flat.size === 0) return null;

  const byParent = new Map<string | null, FlatNode[]>();
  for (const n of flat.values()) {
    const list = byParent.get(n.parentId) ?? [];
    list.push(n);
    byParent.set(n.parentId, list);
  }

  let roots = (byParent.get(null) ?? []).slice().sort((a, b) => a.id.localeCompare(b.id));
  if (roots.length === 0) {
    roots = [...flat.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 1);
  }
  const rootFlat = roots[0];
  const extraRoots = roots.slice(1);

  const visited = new Set<string>();
  const build = (n: FlatNode): NodeObj => {
    visited.add(n.id);
    const kids = (byParent.get(n.id) ?? [])
      .filter((k) => !visited.has(k.id))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    const obj: NodeObj = { id: n.id, topic: n.topic, ...n.rest };
    const children = kids.map(build);
    if (children.length > 0) obj.children = children;
    return obj;
  };

  const rootObj = build(rootFlat);
  const strayRoots = extraRoots.filter((r) => !visited.has(r.id)).map(build);
  const orphans = [...flat.values()].filter((n) => !visited.has(n.id)).map(build);
  if (strayRoots.length > 0 || orphans.length > 0) {
    rootObj.children = [...(rootObj.children ?? []), ...strayRoots, ...orphans];
  }
  return rootObj;
}
