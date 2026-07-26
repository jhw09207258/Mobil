// applyTextDelta 가 틀리면 협업 문서 내용이 조용히 깨지거나, 다른 사람 커서가
// 매번 튄다. 실행: node lib/yjs-transport.test.mjs
import assert from "node:assert";
import * as Y from "yjs";
import { applyTextDelta } from "./text-delta.ts";

const make = (initial) => {
  const doc = new Y.Doc();
  const t = doc.getText("content");
  if (initial) t.insert(0, initial);
  return t;
};

// 결과가 항상 정확히 next 가 된다 — 이게 최소 요건.
for (const [from, to] of [
  ["", "hello"],
  ["hello", ""],
  ["hello", "hello world"],
  ["hello world", "hello"],
  ["abc", "axc"],
  ["const a = 1;", "const a = 2;"],
  ["line1\nline2\nline3", "line1\nCHANGED\nline3"],
  ["same", "same"],
  ["aaa", "aaaa"],
  ["aaaa", "aaa"],
  ["prefix-MID-suffix", "prefix-OTHER-suffix"],
]) {
  const t = make(from);
  applyTextDelta(t, to);
  assert.equal(t.toString(), to, `${JSON.stringify(from)} -> ${JSON.stringify(to)}`);
}

// 바뀐 게 없으면 false 를 돌려주고 문서를 건드리지 않는다(불필요한 브로드캐스트 방지).
{
  const t = make("unchanged");
  let updates = 0;
  t.doc.on("update", () => updates++);
  assert.equal(applyTextDelta(t, "unchanged"), false);
  assert.equal(updates, 0);
}

// 실제로 바뀌면 true 를 돌려주고 업데이트가 한 번 발생한다.
{
  const t = make("before");
  let updates = 0;
  t.doc.on("update", () => updates++);
  assert.equal(applyTextDelta(t, "after"), true);
  assert.equal(updates, 1, "one transaction, not one per edit");
}

// 공통 접두/접미를 실제로 아껴서 고친다 — 한 글자만 바뀌면 한 글자만 건드려야
// 다른 사람 커서가 안 튄다.
{
  const t = make("0123456789");
  let delta = null;
  t.observe((e) => (delta = e.delta));
  applyTextDelta(t, "012X456789");
  // retain 3 → 앞 3글자는 그대로 두고 그 자리만 고쳤다는 뜻.
  assert.equal(delta[0].retain, 3, `expected retain 3, got ${JSON.stringify(delta)}`);
}

// 두 문서가 같은 델타로 수렴한다(브로드캐스트 왕복 시뮬레이션).
// 주의: 양쪽에 같은 텍스트를 따로 insert 하면 서로 다른 오퍼레이션이라 병합 시
// 이어붙는다 — 그래서 실제 코드도 초기 내용을 seedDeterministically 로 넣는다.
// 여기서는 한쪽에서 만든 상태를 다른 쪽에 복제해 진짜 피어를 흉내낸다.
{
  const a = make("shared text");
  const bDoc = new Y.Doc();
  Y.applyUpdate(bDoc, Y.encodeStateAsUpdate(a.doc));
  const b = bDoc.getText("content");
  assert.equal(b.toString(), "shared text");

  applyTextDelta(a, "shared NEW text");
  Y.applyUpdate(bDoc, Y.encodeStateAsUpdate(a.doc));
  assert.equal(b.toString(), "shared NEW text");

  // 반대 방향도 — 한쪽 편집이 상대에게 그대로 반영된다.
  applyTextDelta(b, "shared NEW text!");
  Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(bDoc));
  assert.equal(a.toString(), "shared NEW text!");
}

console.log("text-delta: 20 checks passed");

// ---- mergeContentIntoSnapshot (서버에서 에이전트 변경을 얹는 경로) ----
import { mergeContentIntoSnapshot, encodeUpdate, decodeUpdate } from "./text-delta.ts";

const textOf = (b64) => {
  const d = new Y.Doc();
  Y.applyUpdate(d, decodeUpdate(b64));
  return d.getText("content").toString();
};

// 스냅샷이 없으면 새로 만들어 내용을 담는다.
assert.equal(textOf(mergeContentIntoSnapshot(null, "hello").snapshot), "hello");

// 기존 스냅샷 위에 얹으면 내용이 교체된다(이어붙지 않는다).
{
  const base = make("original text");
  const snap = encodeUpdate(Y.encodeStateAsUpdate(base.doc));
  const merged = mergeContentIntoSnapshot(snap, "updated text");
  assert.equal(textOf(merged.snapshot), "updated text");
}

// 핵심: 병합 결과가 원래 문서의 이력을 잇는다 — 그 스냅샷을 들고 있던
// 편집기가 업데이트를 받으면 내용이 수렴한다(협업 세션이 안 깨진다).
{
  const live = make("shared code");
  const snap = encodeUpdate(Y.encodeStateAsUpdate(live.doc));
  const merged = mergeContentIntoSnapshot(snap, "shared code + agent edit");
  // 전체 스냅샷이 아니라 "증분 업데이트"만 받아도 수렴해야 한다 —
  // 브로드캐스트로 나가는 게 이 증분이다.
  assert.ok(merged.update, "expected an incremental update");
  Y.applyUpdate(live.doc, decodeUpdate(merged.update));
  assert.equal(live.toString(), "shared code + agent edit");
  // 증분은 전체 스냅샷보다 작아야 의미가 있다.
  assert.ok(merged.update.length < merged.snapshot.length);
}

// 손상된 스냅샷은 버리고 새로 시드한다(터지지 않는다).
assert.equal(textOf(mergeContentIntoSnapshot("!!!not-base64!!!", "recovered").snapshot), "recovered");

// 빈 내용으로도 동작한다.
assert.equal(textOf(mergeContentIntoSnapshot(null, "").snapshot), "");

// 바뀐 게 없으면 브로드캐스트할 것도 없다.
{
  const base = make("same");
  const snap = encodeUpdate(Y.encodeStateAsUpdate(base.doc));
  assert.equal(mergeContentIntoSnapshot(snap, "same").update, null);
}

console.log("mergeContentIntoSnapshot: 9 checks passed");
