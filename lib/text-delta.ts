import * as Y from "yjs";

/**
 * Y.Text 를 next 로 맞추되, 앞뒤 공통 부분을 뺀 최소 구간만 고친다.
 *
 * 통째로 지우고 다시 넣으면 협업 문서의 델타가 불필요하게 커지고 같은 문서를
 * 보고 있는 다른 사람의 커서가 튄다. 에이전트가 고친 파일을 열려 있는 편집기에
 * 반영할 때도 이 경로를 쓴다 — 그래야 변경이 Yjs 업데이트로 전파되고
 * 자동저장까지 이어진다.
 */
export function applyTextDelta(ytext: Y.Text, next: string): boolean {
  const cur = ytext.toString();
  if (cur === next) return false;

  let head = 0;
  const max = Math.min(cur.length, next.length);
  while (head < max && cur[head] === next[head]) head++;
  let tail = 0;
  while (
    tail < max - head &&
    cur[cur.length - 1 - tail] === next[next.length - 1 - tail]
  ) tail++;

  const removed = cur.length - head - tail;
  const inserted = next.slice(head, next.length - tail);
  ytext.doc?.transact(() => {
    if (removed > 0) ytext.delete(head, removed);
    if (inserted) ytext.insert(head, inserted);
  });
  return true;
}

// base64 인코딩은 브라우저와 Node 양쪽에서 같은 구현으로 돈다(btoa/atob 는
// Node 16+ 에도 있다). 서버 라우트에서도 써야 해서 이 파일에 둔다 —
// yjs-transport 는 "use client" 라 서버에서 import 할 수 없다.
export function encodeUpdate(update: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < update.length; i++) binary += String.fromCharCode(update[i]);
  return btoa(binary);
}

export function decodeUpdate(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * 서버에서 만든 내용을 기존 Yjs 스냅샷 위에 얹어 새 스냅샷을 만든다.
 *
 * 에이전트가 파일을 고칠 때 yjs_state 를 그냥 null 로 지우면, 그 파일을 열어 둔
 * 사람의 협업 스냅샷이 통째로 날아간다. 대신 이전 상태에서 문서를 복원해
 * 최소 델타만 적용하면, 다음에 파일을 여는 쪽이 정상적인 Yjs 이력을 이어받는다.
 *
 * 스냅샷이 없거나 깨져 있으면 새 문서를 결정적으로 시드한다(clientID 1) —
 * 두 곳에서 같은 내용을 동시에 시드해도 병합 시 내용이 복제되지 않는다.
 */
export function mergeContentIntoSnapshot(
  yjsState: string | null,
  nextContent: string
): string {
  const doc = new Y.Doc();
  let restored = false;
  if (yjsState) {
    try {
      Y.applyUpdate(doc, decodeUpdate(yjsState));
      restored = true;
    } catch {
      // 손상된 스냅샷 — 아래에서 새로 시드한다.
    }
  }
  const ytext = doc.getText("content");
  if (!restored && ytext.length === 0) {
    const original = doc.clientID;
    doc.clientID = 1;
    try {
      ytext.insert(0, nextContent);
    } finally {
      doc.clientID = original === 1 ? new Y.Doc().clientID : original;
    }
  } else {
    applyTextDelta(ytext, nextContent);
  }
  return encodeUpdate(Y.encodeStateAsUpdate(doc));
}
