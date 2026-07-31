// #태그 추출 검증 — 특히 "#parent/child" 중첩 태그가 한 덩어리로 뽑히는지.
// 실행: node lib/tags.test.mjs
import assert from "node:assert";
import test from "node:test";
import { extractTagsFromText } from "./tags.ts";

test("단순 태그는 지금까지처럼 그대로 뽑힌다", () => {
  assert.deepEqual(extractTagsFromText("오늘 할 일 #urgent #work 정리"), ["urgent", "work"]);
});

test("#parent/child 는 하나의 태그로 뽑힌다(끊어지지 않는다)", () => {
  assert.deepEqual(extractTagsFromText("메모 #project/possion 관련"), ["project/possion"]);
});

test("3단 이상 중첩도 된다", () => {
  assert.deepEqual(extractTagsFromText("#work/possion/backend 노트"), ["work/possion/backend"]);
});

test("소문자로 정규화된다(부모/자식 각 조각 모두)", () => {
  assert.deepEqual(extractTagsFromText("#Project/Possion"), ["project/possion"]);
});

test("같은 태그가 여러 번 나오면 한 번만 남는다", () => {
  assert.deepEqual(extractTagsFromText("#work/a 그리고 다시 #work/a"), ["work/a"]);
});

test("부모 태그와 자식 태그는 서로 다른 태그로 남는다(자동 병합하지 않는다)", () => {
  assert.deepEqual(extractTagsFromText("#work 그리고 #work/possion"), ["work", "work/possion"]);
});

test("깊이 상한(부모 포함 5단)을 넘는 부분은 태그에서 잘려나간다", () => {
  // #a/b/c/d/e/f 는 6단 — 5단(a/b/c/d/e)까지만 태그로 잡히고 "/f" 는 태그 밖의
  // 일반 텍스트로 남는다(슬래시로 시작하는 텍스트라 매치되지 않는다).
  assert.deepEqual(extractTagsFromText("#a/b/c/d/e/f"), ["a/b/c/d/e"]);
});

test("슬래시로 끝나면 그 슬래시는 태그에 포함되지 않는다", () => {
  assert.deepEqual(extractTagsFromText("이 태그는 #work/ 다음에 슬래시가 있다"), ["work"]);
});
