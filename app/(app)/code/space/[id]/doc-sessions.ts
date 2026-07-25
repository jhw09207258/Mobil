import * as Y from "yjs";
import {
  connectYjsBroadcast,
  decodeYUpdate,
  encodeYUpdate,
  seedDeterministically,
} from "@/lib/yjs-transport";
import { applyTextDelta } from "@/lib/text-delta";

// ============================================================================
// 열려 있는 탭마다 Yjs 문서 하나.
//
// 낱개 편집기(/code/[id])와 같은 `code:<id>` 토픽에 붙으므로, 같은 파일을 두
// 화면에서 열어도 서로의 편집이 실시간으로 수렴한다. 예전 워크스페이스는 Yjs
// 없이 content 만 쓰면서 yjs_state 를 지웠고, 그게 상대 협업 세션을 끊었다.
//
// content 는 편집기가 아니라 Y.Text 관찰로 갱신한다. 백그라운드 탭에는 편집기가
// 붙어 있지 않아 onChange 가 안 오는데, 원격 편집은 계속 들어온다 — 편집기에만
// 의존하면 그 탭의 content 가 낡은 채로 남아 "모두 저장" 이 상대 변경을
// 덮어쓴다.
//
// 탭이 여러 개라 문서도 여러 개다 — 닫을 때 반드시 관찰을 떼고 브로드캐스트를
// 끊고 문서를 파기해야 채널과 메모리가 샌다.
// ============================================================================

export type DocSession = {
  fileId: string;
  ydoc: Y.Doc;
  ytext: Y.Text;
  /** 원격 업데이트 적용 중 — 이때는 자동저장을 걸지 않는다. */
  isApplyingRemote: { current: boolean };
  /** 문서의 현재 텍스트(관찰로 항상 최신). */
  content: string;
  /** 마지막으로 저장한 텍스트 — dirty 판정과 diff 의 기준. */
  saved: string;
  timer: ReturnType<typeof setTimeout> | null;
  dispose: () => void;
};

export function createSession(opts: {
  fileId: string;
  content: string;
  yjsState: string | null;
  /** 문서가 바뀔 때마다. remote 면 이 클라이언트가 친 게 아니다. */
  onChange: (fileId: string, remote: boolean) => void;
}): DocSession {
  const ydoc = new Y.Doc();
  if (opts.yjsState) {
    try {
      Y.applyUpdate(ydoc, decodeYUpdate(opts.yjsState));
    } catch {
      // 손상된 스냅샷은 무시 — 아래에서 비어 있으면 content 로 채운다.
    }
  }
  const ytext = ydoc.getText("content");
  if (ytext.length === 0 && opts.content) {
    // 결정적 시드 — 두 클라이언트가 동시에 시드해도 병합 시 내용이 복제되지 않는다.
    seedDeterministically(ydoc, () => ytext.insert(0, opts.content));
  }

  const isApplyingRemote = { current: false };
  const disconnect = connectYjsBroadcast(ydoc, `code:${opts.fileId}`, isApplyingRemote);

  const text = ytext.toString();
  const session: DocSession = {
    fileId: opts.fileId,
    ydoc,
    ytext,
    isApplyingRemote,
    content: text,
    saved: text,
    timer: null,
    dispose: () => {},
  };

  const observer = () => {
    session.content = ytext.toString();
    opts.onChange(opts.fileId, isApplyingRemote.current);
  };
  ytext.observe(observer);

  session.dispose = () => {
    if (session.timer) clearTimeout(session.timer);
    ytext.unobserve(observer);
    disconnect();
    ydoc.destroy();
  };

  return session;
}

export function destroySession(session: DocSession): void {
  session.dispose();
}

/** 저장용 Yjs 스냅샷. */
export function snapshot(session: DocSession): string {
  return encodeYUpdate(Y.encodeStateAsUpdate(session.ydoc));
}

/**
 * 서버에서 읽어온 내용을 살아 있는 문서에 반영한다.
 *
 * 문서를 갈아끼우지 않고 최소 델타로 고치는 게 중요하다 — 그래야 변경이 Yjs
 * 업데이트로 다른 접속자에게 전파되고, 커서도 튀지 않는다. 에이전트가 고친
 * 파일을 열려 있는 탭에 반영하는 경로가 이것이다.
 */
export function applyRemoteContent(session: DocSession, next: string): boolean {
  return applyTextDelta(session.ytext, next);
}
