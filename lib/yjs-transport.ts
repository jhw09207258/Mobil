"use client";

import * as Y from "yjs";
import { createClient } from "@/lib/supabase/client";

export function encodeYUpdate(update: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < update.length; i++) binary += String.fromCharCode(update[i]);
  return btoa(binary);
}

export function decodeYUpdate(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const REMOTE_ORIGIN = "remote-broadcast";

/**
 * Supabase Realtime Broadcast 를 전송 계층으로 쓰는 최소 Yjs 동기화.
 *
 * 별도 y-websocket 서버 없이, 같은 topic 을 구독한 클라이언트끼리 Yjs 바이너리
 * 업데이트를 그대로 주고받는다. Broadcast 는 과거 이력을 보관/재전송하지
 * 않으므로 접속 시점의 상태는 DB 스냅샷(yjs_state)에서 복원하고, 스냅샷에
 * 없는 "진행 중" 편집은 구독 직후의 상태벡터 핸드셰이크로 따라잡는다:
 *
 *   1. 구독되면(재접속 포함) 내 상태벡터를 sync-req 로 브로드캐스트.
 *   2. 받은 쪽은 sync-res 로 (a) 상대에게 없는 부분의 diff 업데이트와
 *      (b) 자기 상태벡터를 돌려준다.
 *   3. sync-req 발신자는 diff 를 적용하고, 상대 상태벡터 기준으로 자기만
 *      가진 부분이 있으면 yupdate 로 마저 보낸다(양방향 수렴).
 *
 * 이 핸드셰이크가 없으면 먼저 들어와 편집 중이던 클라이언트의 미저장 조작이
 * 뒤에 들어온 클라이언트의 Yjs 에 "의존성 없는 업데이트"로 무한 보류되어,
 * 한쪽 편집만 보이는 비대칭 증상이 났다. 열람 전용 사용자는 브로드캐스트
 * 발신 권한이 없어 sync-req 를 못 보내므로(0029 RLS), 스냅샷 이후의 미저장
 * 편집은 다음 저장 전까지 못 볼 수 있다 — 알려진 잔여 한계.
 */
/**
 * @param isApplyingRemoteRef 채워두면, 원격 업데이트를 ydoc 에 적용하는 동안
 * (Y.applyUpdate 호출을 감싸는 동기 구간) true 로 설정된다. 편집기 쪽에서
 * 이 값을 참조해 원격발 변경으로 트리거된 onUpdate/onChange 에서는 자동저장을
 * 걸지 않게 하는 데 쓴다 — 그렇지 않으면 동시 편집자 수만큼 저장 요청이
 * 배가되고(각자 서로의 변경에도 반응해 저장), 실제로는 자신이 안 건드린
 * 순간에도 저장 상태 표시가 깜빡인다.
 */
export function connectYjsBroadcast(
  ydoc: Y.Doc,
  topic: string,
  isApplyingRemoteRef?: { current: boolean }
): () => void {
  const supabase = createClient();
  const channel = supabase.channel(topic, {
    // private: true 로 realtime.messages 의 RLS(0029 마이그레이션)를 태워
    // 문서/코드 파일의 view/edit 권한을 브로드캐스트 채널에도 강제한다.
    // (public 채널은 RLS 를 아예 거치지 않아 토픽 이름만 알면 누구나 주입 가능)
    config: { broadcast: { self: false, ack: false }, private: true },
  });

  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN) return;
    channel.send({
      type: "broadcast",
      event: "yupdate",
      payload: { u: encodeYUpdate(update) },
    });
  };
  ydoc.on("update", onUpdate);

  const applyRemote = (u: string) => {
    if (isApplyingRemoteRef) isApplyingRemoteRef.current = true;
    try {
      Y.applyUpdate(ydoc, decodeYUpdate(u), REMOTE_ORIGIN);
    } finally {
      if (isApplyingRemoteRef) isApplyingRemoteRef.current = false;
    }
  };

  // diff 가 실질 내용 없이 헤더만 있는 경우(빈 업데이트)는 보내지 않는다.
  const hasContent = (update: Uint8Array) => update.length > 3;

  channel
    .on("broadcast", { event: "yupdate" }, ({ payload }) => {
      const u = (payload as { u?: string } | null)?.u;
      if (!u) return;
      applyRemote(u);
    })
    .on("broadcast", { event: "sync-req" }, ({ payload }) => {
      const sv = (payload as { sv?: string } | null)?.sv;
      if (!sv) return;
      try {
        const diff = Y.encodeStateAsUpdate(ydoc, decodeYUpdate(sv));
        channel.send({
          type: "broadcast",
          event: "sync-res",
          payload: {
            u: hasContent(diff) ? encodeYUpdate(diff) : null,
            sv: encodeYUpdate(Y.encodeStateVector(ydoc)),
          },
        });
      } catch {
        // 손상된 상태벡터 — 무시(상대는 스냅샷 상태로 계속 동작).
      }
    })
    .on("broadcast", { event: "sync-res" }, ({ payload }) => {
      const p = payload as { u?: string | null; sv?: string } | null;
      if (!p) return;
      if (p.u) applyRemote(p.u);
      if (!p.sv) return;
      try {
        const diff = Y.encodeStateAsUpdate(ydoc, decodeYUpdate(p.sv));
        if (hasContent(diff)) {
          channel.send({
            type: "broadcast",
            event: "yupdate",
            payload: { u: encodeYUpdate(diff) },
          });
        }
      } catch {
        // 무시 — 다음 일반 업데이트에서 수렴.
      }
    })
    .subscribe((status) => {
      // 최초 구독과 재연결 모두에서 따라잡기를 시작한다.
      if (status === "SUBSCRIBED") {
        channel.send({
          type: "broadcast",
          event: "sync-req",
          payload: { sv: encodeYUpdate(Y.encodeStateVector(ydoc)) },
        });
      }
    });

  return () => {
    ydoc.off("update", onUpdate);
    supabase.removeChannel(channel);
  };
}

/**
 * 레거시(스냅샷 없는) 콘텐츠를 Y.Doc 에 시드할 때 두 클라이언트가 "동시에"
 * 시드해도 병합 시 내용이 복제되지 않도록, 고정 clientID(1) 로 결정적 시드를
 * 만든다 — 같은 입력이면 양쪽이 바이트 동일한 오퍼레이션을 생성해 Yjs 가
 * 같은 것으로 병합한다. 시드 후에는 반드시 무작위 clientID 로 되돌린다
 * (같은 clientID 로 계속 편집하면 서로의 오퍼레이션이 충돌해 문서가 깨진다).
 */
export function seedDeterministically(ydoc: Y.Doc, seed: () => void): void {
  const original = ydoc.clientID;
  ydoc.clientID = 1;
  try {
    seed();
  } finally {
    ydoc.clientID = original === 1 ? new Y.Doc().clientID : original;
  }
}
