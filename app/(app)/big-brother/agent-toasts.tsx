"use client";

import { useRouter } from "next/navigation";
import { dismissNotice, useAgentStore } from "./agent-store";

/**
 * Agent 실행 완료 알림.
 *
 * 앱 레이아웃에 상시 마운트되므로 어느 화면에 있든 뜬다 — 에이전트를 돌려놓고
 * 다른 일을 하다가 끝난 걸 알 수 있어야 "백그라운드에서 돈다"가 의미를 갖는다.
 * 클릭하면 그 Code Space 의 콘솔로 데려간다.
 */
export function AgentToasts() {
  const { notices } = useAgentStore();
  const router = useRouter();
  if (notices.length === 0) return null;

  return (
    <div className="agent-toasts" aria-live="polite">
      {notices.map((n) => (
        <div key={n.id} className={`agent-toast ${n.ok ? "" : "failed"}`}>
          <button
            className="agent-toast-main"
            onClick={() => {
              dismissNotice(n.id);
              router.push("/big-brother");
            }}
          >
            <span className="agent-toast-head">
              <span className="agent-toast-dot" />
              Agent {n.ok ? "finished" : "failed"} — {n.spaceName}
            </span>
            <span className="agent-toast-body">{n.summary}</span>
          </button>
          <button
            className="agent-toast-close"
            onClick={() => dismissNotice(n.id)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
