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
 * 않으므로 접속 시점의 상태는 DB 스냅샷(yjs_state, 저장 시점마다 갱신)에서
 * 복원하고, 그 이후부터는 현재 접속 중인 클라이언트끼리만 실시간으로
 * 수렴한다 — 세션 도중 끊겼다 다시 붙는 클라이언트는 다음 새로고침(스냅샷
 * 재로딩) 전까지 일시적으로 어긋날 수 있는 것이 이 방식의 알려진 한계다.
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

  channel
    .on("broadcast", { event: "yupdate" }, ({ payload }) => {
      const u = (payload as { u?: string } | null)?.u;
      if (!u) return;
      if (isApplyingRemoteRef) isApplyingRemoteRef.current = true;
      try {
        Y.applyUpdate(ydoc, decodeYUpdate(u), REMOTE_ORIGIN);
      } finally {
        if (isApplyingRemoteRef) isApplyingRemoteRef.current = false;
      }
    })
    .subscribe();

  return () => {
    ydoc.off("update", onUpdate);
    supabase.removeChannel(channel);
  };
}
