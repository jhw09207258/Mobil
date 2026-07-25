"use client";

import { useEffect } from "react";

/**
 * (app) 세그먼트 에러 경계 — Next.js 기본 화면("Application error: a
 * client-side exception has occurred")은 원인을 전혀 알려주지 않아 특히
 * 모바일에서 진단이 불가능하다. 실제 메시지/스택을 화면에 그대로 보여줘
 * 브라우저 콘솔을 열 수 없는 기기(아이폰 등)에서도 원인을 읽을 수 있게 한다.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 콘솔을 볼 수 있는 환경에서는 전체 객체를 그대로 남긴다.
    console.error("[Possion] app error:", error);
  }, [error]);

  return (
    <div className="content" style={{ padding: 24, overflowY: "auto" }}>
      <div className="panel" style={{ padding: 20, maxWidth: 720 }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 500 }}>
          Something broke on this screen
        </h2>
        <p className="page-sub" style={{ margin: "0 0 16px" }}>
          The rest of the app is still fine — you can retry, or copy the details
          below so the problem can be fixed.
        </p>

        <div className="row" style={{ gap: 8, marginBottom: 16 }}>
          <button className="btn btn-primary btn-sm" onClick={reset}>
            Try again
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              const text = [
                `message: ${error.message}`,
                error.digest ? `digest: ${error.digest}` : "",
                `ua: ${navigator.userAgent}`,
                `url: ${window.location.href}`,
                "",
                error.stack ?? "(no stack)",
              ]
                .filter(Boolean)
                .join("\n");
              navigator.clipboard?.writeText(text).catch(() => {
                /* 클립보드 권한 없음 — 아래 본문을 직접 선택해 복사 */
              });
            }}
          >
            Copy details
          </button>
        </div>

        <div className="label" style={{ marginBottom: 6 }}>
          ERROR
        </div>
        <div
          className="code-block"
          style={{ fontSize: 12.5, whiteSpace: "pre-wrap", userSelect: "text" }}
        >
          {error.message || "(no message)"}
          {error.digest ? `\n\ndigest: ${error.digest}` : ""}
        </div>

        {error.stack && (
          <details style={{ marginTop: 14 }}>
            <summary
              className="label"
              style={{ cursor: "pointer", marginBottom: 6 }}
            >
              STACK TRACE
            </summary>
            <div
              className="code-block"
              style={{
                fontSize: 11,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                userSelect: "text",
                maxHeight: 320,
                overflowY: "auto",
              }}
            >
              {error.stack}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
