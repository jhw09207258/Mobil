// 트리 구성이 틀리면 파일이 조용히 사라져 보이고, 매칭이 틀리면 Cmd+P 가
// 파일을 못 찾는다. 실행: node "app/(app)/code/space/[id]/tree-utils.test.mjs"
import assert from "node:assert";
import { buildTree, fuzzyMatch } from "./tree-utils.ts";

const f = (id, path) => ({ id, name: path.split("/").pop(), path });

// 1. 중첩 경로가 폴더로 접힌다.
{
  const tree = buildTree([f("1", "src/app/page.tsx"), f("2", "src/lib/util.ts"), f("3", "README.md")]);
  // 폴더(src) 가 파일(README.md) 보다 앞.
  assert.deepEqual(tree.map((n) => n.name), ["src", "README.md"]);
  const src = tree[0];
  assert.deepEqual(src.children.map((n) => n.name), ["app", "lib"]);
  assert.equal(src.children[0].children[0].file.id, "1");
  assert.equal(src.path, "src");
  assert.equal(src.children[0].path, "src/app");
}

// 2. 같은 폴더의 파일들이 한 노드 아래 모인다(폴더가 중복 생성되면 안 된다).
{
  const tree = buildTree([f("1", "src/a.ts"), f("2", "src/b.ts")]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].children.length, 2);
}

// 3. 같은 이름의 폴더와 파일이 공존해도 서로를 덮어쓰지 않는다.
{
  const tree = buildTree([f("1", "docs"), f("2", "docs/intro.md")]);
  assert.equal(tree.length, 2);
  assert.ok(tree.some((n) => n.file && n.name === "docs"));
  assert.ok(tree.some((n) => !n.file && n.name === "docs"));
}

// 4. path 가 없으면 name 으로 대신한다(과거 데이터).
{
  const tree = buildTree([{ id: "1", name: "loose.ts", path: null }]);
  assert.equal(tree[0].name, "loose.ts");
  assert.equal(tree[0].file.id, "1");
}

// 5. 빈 목록과 빈 경로에서 터지지 않는다.
{
  assert.deepEqual(buildTree([]), []);
  assert.deepEqual(buildTree([{ id: "1", name: "", path: "" }]), []);
}

// 6. 부분수열 매칭 — 흩어진 글자, 대소문자 무시.
assert.ok(fuzzyMatch("src/app/page.tsx", "sapp"));
assert.ok(fuzzyMatch("src/app/page.tsx", "PAGE"));
assert.ok(fuzzyMatch("src/app/page.tsx", "s a p")); // 공백 무시
assert.ok(fuzzyMatch("anything", "")); // 빈 질의는 전부 통과
// 순서가 어긋나면 안 맞는다.
assert.ok(!fuzzyMatch("src/app/page.tsx", "xtp"));
assert.ok(!fuzzyMatch("src/app/page.tsx", "zzz"));

console.log("tree-utils: 18 checks passed");
