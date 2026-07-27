"use client";

import { useEffect, useState } from "react";
import { Copyable } from "@/components/copyable";
import { getNotifyDispatchToken } from "./actions";

/**
 * 일정 알림 발송기가 쓰는 토큰.
 *
 * 이 값은 배포 환경 변수 `NOTIFY_DISPATCH_TOKEN` 에 그대로 넣어야 한다. 왜
 * 이런 손이 가는 방식인가 — 발송기는 로그인 없이 도는 배치라 자신을 증명할
 * 수단이 필요한데, 그 자리에 Supabase 서비스 롤 키를 넣고 싶지 않기 때문이다.
 * 그 키는 모든 RLS 를 무시한다. 이 토큰은 "지금 보낼 알림 목록" 하나만 연다.
 */
export function DispatchToken() {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (rotate: boolean) => {
    setBusy(true);
    setError(null);
    getNotifyDispatchToken(rotate).then(
      (res) => {
        setBusy(false);
        if ("error" in res) setError(res.error);
        else setToken(res.token);
      },
      () => {
        setBusy(false);
        setError("Could not read the dispatch token.");
      }
    );
  };

  useEffect(() => {
    load(false);
  }, []);

  return (
    <>
      {error && <div className="notice notice-error">{error}</div>}
      <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.65, marginTop: 0 }}>
        Event reminders (&ldquo;starts in 10 minutes&rdquo;) are sent by a batch job that runs
        without a logged-in user. Put this value in the deployment environment as{" "}
        <code className="mono">NOTIFY_DISPATCH_TOKEN</code> and redeploy. Chat and invitation
        notifications do not need it — only timed reminders do.
      </p>
      {token ? <Copyable value={token} label="Dispatch token" secret /> : <div className="empty">{busy ? "Loading…" : "—"}</div>}
      <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button className="btn btn-sm" disabled={busy} onClick={() => load(true)}>
          Rotate
        </button>
        <span className="muted" style={{ fontSize: 11 }}>
          Rotating stops the old value immediately — update the environment variable in the same
          sitting, or reminders stop going out.
        </span>
      </div>
    </>
  );
}
