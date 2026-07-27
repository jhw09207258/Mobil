/**
 * 보안 헤더 구성. next.config.mjs 의 headers() 대신 미들웨어에서 경로별로
 * 직접 적용한다 — Next.js 가 동일 경로에 매칭되는 여러 headers() 항목의
 * Content-Security-Policy 를 병합할 때 각 정책의 교집합(가장 제한적인 합)으로
 * 강제하므로, 정적 next.config 설정만으로는 "이 경로에서만 완화" 를 안전하게
 * 표현할 수 없다. 미들웨어는 요청당 하나의 헤더 집합만 만들어 보내므로 이
 * 문제가 없다.
 *
 * script-src 는 기본적으로 'unsafe-eval' 을 포함하지 않는다. 단, /sheets 는
 * @fortune-sheet 코어가 행/열 삽입 시 내부적으로 `new Function(...)` 을 사용해
 * 배열을 스플라이스하므로 예외적으로 허용한다(라이브러리 구현 세부사항이며
 * 사용자 입력이 그 문자열에 들어가지 않아 인젝션 경로는 아니다).
 */
export function buildSecurityHeaders(pathname: string): [string, string][] {
  const needsEval = pathname.startsWith("/sheets");

  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob: https://*.supabase.co",
    "media-src 'self' blob: https://*.supabase.co",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline'${needsEval ? " 'unsafe-eval'" : ""}`,
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "worker-src 'self' blob:",
    // 파일 미리보기(PDF)는 Storage 도메인을 프레임에 직접 걸지 않는다 — 내용을
    // 받아 blob: URL 로 바꿔 넣으므로 blob: 만 허용하면 된다. 원격 오리진을
    // 프레임에 허용하는 것보다 좁다.
    "frame-src 'self' blob:",
  ].join("; ");

  return [
    ["Content-Security-Policy", csp],
    ["X-Frame-Options", "DENY"],
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    [
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    ],
    [
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    ],
  ];
}
