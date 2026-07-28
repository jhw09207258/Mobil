import { createRequire } from "node:module";

/**
 * 보안 헤더(CSP 포함)는 middleware.ts 에서 경로별로 적용한다.
 * (이유: lib/security-headers.ts 상단 주석 참고)
 */

// y-monaco 는 `monaco-editor/esm/vs/editor/editor.api.js` 를 임포트하는데,
// monaco-editor 의 package.json exports 가 "./*" → "./esm/vs/*.js" 로 매핑하므로
// 접두사가 두 번 붙어("esm/vs/esm/vs/...") 해석에 실패한다. y-monaco 가
// exports 필드 도입 이전에 작성된 탓이라 우리 쪽에서 실제 파일로 별칭을 건다.
const require = createRequire(import.meta.url);
const monacoApi = require.resolve("monaco-editor/editor/editor.api.js");
const MONACO_LEGACY_SPECIFIER = "monaco-editor/esm/vs/editor/editor.api.js";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  productionBrowserSourceMaps: false,
  // web-push 는 서버에서만 쓰는 CommonJS 패키지다. 번들러가 끌어안으면 배포
  // 환경(서버리스)에서만 로드에 실패하는 부류의 문제가 생길 수 있으므로,
  // 번들에 넣지 말고 런타임에 Node 가 직접 require 하게 둔다.
  serverExternalPackages: ["web-push"],
  experimental: {
    // 대형 CodeMirror/Tiptap/fortune-sheet 임포트를 트리셰이킹 친화적으로 최적화
    optimizePackageImports: [
      "@codemirror/view",
      "@codemirror/state",
      "@codemirror/language",
      "@tiptap/react",
      "@tiptap/starter-kit",
    ],
  },
  turbopack: {
    resolveAlias: { [MONACO_LEGACY_SPECIFIER]: monacoApi },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      [MONACO_LEGACY_SPECIFIER]: monacoApi,
    };
    return config;
  },
};

export default nextConfig;
