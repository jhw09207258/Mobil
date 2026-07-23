import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";
import { DesktopChrome } from "./desktop-chrome";

// 전체 UI 폰트 — Noto Sans KR(한글+라틴 모두 커버). 볼드(700)는 싣지 않는다
// — 굵은 강조는 500(medium)까지만 사용한다.
const notoSans = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-noto",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mobil",
  description: "A private idea vault for personal and security work — files, documents and code in one place",
};

// 편집기(문서/코드/시트) 사용 중 핀치·더블탭 확대가 걸려 타이핑을 방해하지
// 않도록 PC/태블릿/모바일 전부에서 확대를 막는다.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

// Supabase 오리진에 미리 DNS 조회 + TCP/TLS 핸드셰이크를 걸어두면(preconnect)
// 로그인·데이터 조회 등 첫 요청의 왕복 지연이 줄어든다. 환경변수가 없을 때는
// 링크를 렌더링하지 않는다.
const SUPABASE_ORIGIN = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
      : null;
  } catch {
    return null;
  }
})();

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className={notoSans.variable}>
      <head>
        {SUPABASE_ORIGIN && (
          <>
            <link rel="preconnect" href={SUPABASE_ORIGIN} crossOrigin="anonymous" />
            <link rel="dns-prefetch" href={SUPABASE_ORIGIN} />
          </>
        )}
        {/* 사용자 테마(라이트/다크, lib/theme.ts)를 첫 페인트 전에 적용해
            기본(다크) 테마가 잠깐 보이는 깜빡임을 막는다. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("mobil.theme.v2")==="light")document.documentElement.dataset.theme="light"}catch(e){}`,
          }}
        />
      </head>
      <body>
        <DesktopChrome />
        {children}
      </body>
    </html>
  );
}
