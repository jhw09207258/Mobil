import type { Metadata, Viewport } from "next";
import { Noto_Sans } from "next/font/google";
import "./globals.css";

// 라틴 자소는 Noto Sans 를 self-host(빌드시 번들)로 로드하고,
// 한글은 시스템 한글 폰트로 폴백한다(대형 CJK 웹폰트 미전송 → 최적화).
const notoSans = Noto_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
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
        {/* 사용자 테마(lib/theme.ts 가 저장한 계산된 CSS 변수)를 첫 페인트 전에
            적용해 기본 테마가 잠깐 보이는 깜빡임을 막는다. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var s=JSON.parse(localStorage.getItem("mobil.theme.v1"));if(s&&s.vars){for(var k in s.vars)document.documentElement.style.setProperty(k,s.vars[k])}}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
