// buildSources 는 상한을 넘는 Code Space 를 잘라내는데, 잘못 자르면 에이전트가
// 없는 파일을 고치려 들거나 조용히 코드가 빠진다. 실행: node lib/antigravity.test.mjs
import assert from "node:assert";
import { buildSources, summarizeStep, MAX_MOUNT_BYTES } from "./antigravity.ts";

// 1. 상한 아래면 전부 마운트된다.
{
  const files = [
    { path: "a.ts", content: "x".repeat(10) },
    { path: "b.ts", content: "y".repeat(20) },
  ];
  const { sources, skipped } = buildSources(files);
  assert.equal(sources.length, 2);
  assert.equal(skipped.length, 0);
  assert.deepEqual(
    sources.map((s) => s.target).sort(),
    ["a.ts", "b.ts"]
  );
  assert.equal(sources[0].type, "inline");
}

// 2. 상한을 넘으면 큰 파일이 밀려나고, 작은 파일은 최대한 살아남는다.
{
  const files = [
    { path: "huge.ts", content: "x".repeat(MAX_MOUNT_BYTES) },
    { path: "small.ts", content: "y".repeat(50) },
  ];
  const { sources, skipped } = buildSources(files);
  assert.deepEqual(sources.map((s) => s.target), ["small.ts"]);
  assert.deepEqual(skipped, ["huge.ts"]);
}

// 3. 단일 파일이 상한보다 크면 통째로 스킵된다(잘린 코드를 올리면 안 된다).
{
  const { sources, skipped } = buildSources([
    { path: "big.ts", content: "x".repeat(MAX_MOUNT_BYTES + 1) },
  ]);
  assert.equal(sources.length, 0);
  assert.deepEqual(skipped, ["big.ts"]);
}

// 4. 빈 Code Space 도 터지지 않는다.
{
  const { sources, skipped } = buildSources([]);
  assert.deepEqual(sources, []);
  assert.deepEqual(skipped, []);
}

// 5. commit_files 호출은 저장될 경로를 그대로 보여줘야 한다(UI 가 이걸 찍는다).
{
  const line = summarizeStep({
    type: "function_call",
    name: "commit_files",
    id: "c1",
    arguments: { files: [{ path: "src/a.ts", content: "..." }, { path: "src/b.ts", content: "..." }] },
  });
  assert.equal(line.kind, "edit");
  assert.equal(line.label, "commit 2 file(s)");
  assert.equal(line.detail, "src/a.ts\nsrc/b.ts");
}

// 6. 모르는 step 은 조용히 무시된다(스키마가 preview 라 늘어날 수 있다).
{
  assert.equal(summarizeStep({ type: "something_new_in_preview" }), null);
  assert.equal(summarizeStep({}), null);
}

console.log("antigravity: 6 checks passed");
