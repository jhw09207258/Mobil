// 이 경로는 GitHub 트리와 Vercel 배포 목록으로 그대로 나간다. `..` 이 살아남으면
// 트리 밖을 가리키는 항목이 만들어진다. 실행: node lib/code-space.test.mjs
import assert from "node:assert";
import { sanitizeRepoPath } from "./code-space.ts";

// 평범한 경로는 그대로.
assert.equal(sanitizeRepoPath("src/index.ts"), "src/index.ts");
assert.equal(sanitizeRepoPath("README.md"), "README.md");

// 상위 탈출은 반드시 제거된다.
assert.equal(sanitizeRepoPath("../../etc/passwd"), "etc/passwd");
assert.equal(sanitizeRepoPath("src/../../../secret"), "src/secret");
assert.equal(sanitizeRepoPath(".."), null);
assert.equal(sanitizeRepoPath("../.."), null);

// 선행 슬래시와 샌드박스 접두사는 뗀다.
assert.equal(sanitizeRepoPath("/src/a.ts"), "src/a.ts");
assert.equal(sanitizeRepoPath("workspace/src/a.ts"), "src/a.ts");
assert.equal(sanitizeRepoPath("/workspace/src/a.ts"), "src/a.ts");
// workspace 는 맨 앞에서만 뗀다 — 중간의 같은 이름 폴더는 남겨야 한다.
assert.equal(sanitizeRepoPath("src/workspace/a.ts"), "src/workspace/a.ts");

// 역슬래시(윈도우식)도 구분자로 본다.
assert.equal(sanitizeRepoPath("src\\lib\\a.ts"), "src/lib/a.ts");

// 잉여 슬래시와 . 세그먼트 정리.
assert.equal(sanitizeRepoPath("src//./a.ts"), "src/a.ts");
assert.equal(sanitizeRepoPath("./a.ts"), "a.ts");

// 살릴 수 없는 입력은 null — 호출부가 거절한다.
assert.equal(sanitizeRepoPath(""), null);
assert.equal(sanitizeRepoPath("/"), null);
assert.equal(sanitizeRepoPath("///"), null);
assert.equal(sanitizeRepoPath("workspace"), null);
assert.equal(sanitizeRepoPath(null), null);
assert.equal(sanitizeRepoPath(undefined), null);
assert.equal(sanitizeRepoPath(42), null);

// 제어문자와 NUL 은 거부(경로에 들어갈 이유가 없다).
assert.equal(sanitizeRepoPath("src/a\u0000.ts"), null);
assert.equal(sanitizeRepoPath("src/a\u001f.ts"), null);

// 지나치게 긴 경로도 거부.
assert.equal(sanitizeRepoPath("a/".repeat(300) + "b.ts"), null);

console.log("code-space: 24 checks passed");
