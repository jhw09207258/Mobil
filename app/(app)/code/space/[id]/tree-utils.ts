// 파일 트리 구성과 빠른 열기 매칭. 순수 함수라 node 로 바로 테스트한다
// (그래서 여기서는 아무것도 import 하지 않는다 — repo-actions 는 "use server").

/** buildTree 가 필요로 하는 최소 형태. 실제로는 CodeRepoFile 이 들어온다. */
export type TreeFile = { id: string; name: string; path: string | null };

export type TreeNode<F extends TreeFile = TreeFile> = {
  name: string;
  path: string;
  file?: F;
  children: TreeNode<F>[];
};

/**
 * 경로 목록을 폴더 트리로. 폴더는 실체가 없고 경로에 내포돼 있을 뿐이므로
 * 여기서 세그먼트를 쪼개 만들어낸다.
 */
export function buildTree<F extends TreeFile>(files: F[]): TreeNode<F>[] {
  const root: TreeNode<F> = { name: "", path: "", children: [] };
  for (const f of files) {
    const parts = (f.path || f.name).split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let node = root;
    parts.forEach((part, i) => {
      const isLeaf = i === parts.length - 1;
      // 같은 이름의 폴더와 파일이 공존할 수 있으므로 둘을 구분해서 찾는다.
      let child = node.children.find((c) => c.name === part && !!c.file === isLeaf);
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          children: [],
          ...(isLeaf ? { file: f } : {}),
        };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = (n: TreeNode<F>) => {
    // 폴더 먼저, 그 다음 이름순 — 파일 탐색기의 관례.
    n.children.sort((a, b) => (a.file ? 1 : 0) - (b.file ? 1 : 0) || a.name.localeCompare(b.name));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

/** VS Code 의 Cmd+P 처럼 흩어진 글자로도 맞는 부분수열 매칭. */
export function fuzzyMatch(path: string, query: string): boolean {
  if (!query) return true;
  const p = path.toLowerCase();
  const q = query.toLowerCase().replace(/\s+/g, "");
  let i = 0;
  for (const ch of q) {
    i = p.indexOf(ch, i);
    if (i === -1) return false;
    i++;
  }
  return true;
}
