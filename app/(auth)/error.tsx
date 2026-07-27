"use client";

import { useEffect } from "react";

/**
 * 로그인·회원가입 화면의 오류 경계.
 *
 * 이게 없으면 이 구간에서 난 오류가 최상위(global-error)까지 올라가 루트
 * 레이아웃째로 대체된다 — 사용자는 앱이 통째로 깨진 화면을 보게 되고, 로그인을
 * 다시 시도할 방법조차 사라진다. 여기서 잡아 두면 최소한 "다시 시도"와
 * "로그인으로 돌아가기"가 남는다.
 *
 * digest 를 화면에 보여 주는 이유: 프로덕션 빌드는 실제 메시지를 감추므로
 * 이 값이 서버 로그(`[possion:error]`, instrumentation.ts)와 화면을 잇는
 * 유일한 열쇠다.
 */
export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Possion] auth screen error:", error);
  }, [error]);

  return (
    <div className="auth-wrap">
      <div className="panel" style={{ maxWidth: 420, width: "100%", padding: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 6px", color: "var(--text-0)" }}>
          Sign-in screen could not load
        </h2>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, margin: "0 0 16px" }}>
          Something went wrong on the server. Trying again usually works — if it keeps happening,
          send an administrator the reference below.
        </p>
        <div className="row" style={{ gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <button className="btn btn-primary btn-sm" onClick={reset}>
            Try again
          </button>
          <a className="btn btn-sm" href="/login">
            Back to sign in
          </a>
        </div>
        {error.digest && (
          <p className="mono muted" style={{ fontSize: 11.5, margin: 0 }}>
            reference: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
