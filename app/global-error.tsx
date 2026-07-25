"use client";

import { useEffect } from "react";

/**
 * 최상위 에러 경계 — 루트/세그먼트 레이아웃에서 터진 오류까지 모두 잡는다
 * (세그먼트 error.tsx 는 자기 레이아웃에서 난 오류는 잡지 못한다).
 * 기본 Next.js 화면은 원인을 감추므로 실제 메시지를 그대로 보여준다.
 * 이 컴포넌트는 루트 레이아웃을 대체하므로 html/body 를 직접 렌더링해야 한다.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Possion] global error:", error);
  }, [error]);

  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          padding: 24,
          background: "#141414",
          color: "#e8e8e8",
          fontFamily:
            'system-ui, -apple-system, "Noto Sans KR", "Apple SD Gothic Neo", sans-serif',
          minHeight: "100vh",
        }}
      >
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <h2 style={{ fontSize: 17, fontWeight: 500, margin: "0 0 6px" }}>
            Possion hit an error while loading
          </h2>
          <p style={{ fontSize: 13, color: "#969696", margin: "0 0 16px" }}>
            The details below say what actually went wrong.
          </p>

          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button
              onClick={reset}
              style={{
                height: 32,
                padding: "0 14px",
                fontSize: 13,
                color: "#f0f6ff",
                background: "#3574d0",
                border: "1px solid #285592",
                borderRadius: 10,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
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
              style={{
                height: 32,
                padding: "0 14px",
                fontSize: 13,
                color: "#cccccc",
                background: "#282828",
                border: "1px solid #545454",
                borderRadius: 10,
                cursor: "pointer",
              }}
            >
              Copy details
            </button>
          </div>

          <pre
            style={{
              margin: 0,
              padding: "12px 14px",
              background: "#0d0d0d",
              border: "1px solid #545454",
              borderRadius: 10,
              fontSize: 12.5,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              userSelect: "text",
            }}
          >
            {error.message || "(no message)"}
            {error.digest ? `\n\ndigest: ${error.digest}` : ""}
          </pre>

          {error.stack && (
            <pre
              style={{
                marginTop: 12,
                padding: "12px 14px",
                background: "#0d0d0d",
                border: "1px solid #333",
                borderRadius: 10,
                fontSize: 11,
                lineHeight: 1.6,
                color: "#969696",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                userSelect: "text",
                maxHeight: 320,
                overflowY: "auto",
              }}
            >
              {error.stack}
            </pre>
          )}
        </div>
      </body>
    </html>
  );
}
