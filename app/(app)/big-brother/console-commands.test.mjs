// 슬래시 명령을 잘못 읽으면 사용자가 친 지시가 엉뚱하게 에이전트 프롬프트로
// 새거나 그 반대가 된다. 실행: node app/(app)/code/space/[id]/console-commands.test.mjs
import assert from "node:assert";
import { parseCommand as parse, estimateCost } from "./console-commands.ts";

const MODELS = ["gemini-3.6-flash", "gemini-3.5-flash"];
const parseCommand = (s) => parse(s, MODELS);

// 슬래시가 없으면 전부 에이전트에게 간다.
assert.deepEqual(parseCommand("add a login page"), {
  type: "send",
  text: "add a login page",
});
// 문장 안의 슬래시는 명령이 아니다.
assert.deepEqual(parseCommand("fix src/app/page.tsx"), {
  type: "send",
  text: "fix src/app/page.tsx",
});
// 빈 입력은 아무 것도 아니다.
assert.equal(parseCommand("   "), null);

// 기본 명령들
assert.deepEqual(parseCommand("/help"), { type: "help" });
assert.deepEqual(parseCommand("/ls"), { type: "files" });
assert.deepEqual(parseCommand("/CLEAR"), { type: "clear" });
assert.deepEqual(parseCommand("  /usage  "), { type: "usage" });

// 인자 있는 명령
assert.deepEqual(parseCommand("/open src/index.ts"), {
  type: "open",
  path: "src/index.ts",
});
assert.equal(parseCommand("/open").type, "error");

// 모델은 실제 목록에 있는 것만 받는다 — 오타를 그대로 API 로 보내면 안 된다.
assert.deepEqual(parseCommand("/model gemini-3.5-flash"), {
  type: "model",
  value: "gemini-3.5-flash",
});
assert.deepEqual(parseCommand("/model"), { type: "model" });
assert.equal(parseCommand("/model gpt-4").type, "error");

// 모르는 명령은 에이전트로 새지 않고 에러가 된다.
assert.equal(parseCommand("/nope").type, "error");

// 비용 추정은 0 에서 0 이고 단조 증가한다.
assert.equal(estimateCost(0, 0), 0);
assert.ok(estimateCost(1_000_000, 0) > 0);
assert.ok(estimateCost(0, 1_000_000) > estimateCost(1_000_000, 0));

console.log("console-commands: 14 checks passed");
