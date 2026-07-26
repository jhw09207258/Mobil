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
  title: "Possion",
  description: "A private idea vault for personal and security work — files, documents and code in one place",
  // favicon.ico / icon.png / apple-icon.png 는 app/ 특수 파일 규칙으로 자동
  // 연결된다 — manifest(PWA)·Windows 타일 아이콘만 명시적으로 연결한다.
  manifest: "/manifest.json",
  other: {
    "msapplication-TileColor": "#ffffff",
    "msapplication-TileImage": "/ms-icon-144x144.png",
    "msapplication-config": "/browserconfig.xml",
  },
};

// 편집기(문서/코드/시트) 사용 중 핀치·더블탭 확대가 걸려 타이핑을 방해하지
// 않도록 PC/태블릿/모바일 전부에서 확대를 막는다.
// 제품 결정: 앱 화면은 확대를 잠근다(SaaS UI 라 레이아웃이 확대되면 깨진다).
// 마인드맵은 자체 확대/축소를 갖고 있으므로 그쪽 라우트에서 따로 푼다.
//
// 주의: 이것만으로는 부족하다. iOS Safari 는 10부터 user-scalable 을 무시하고,
// 글자가 16px 미만인 입력에 포커스가 가면 여전히 화면을 확대한다. 그래서
// globals.css 에서 입력 글자를 16px 로 올려 두 겹으로 막는다 — 둘 중 하나만
// 있으면 iOS 에서는 그대로 확대된다.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // 키보드가 뜰 때 화면을 스크롤하지 말고 레이아웃 자체를 줄이라고 지시한다.
  // 이게 먹는 브라우저(Android Chrome 108+)에서는 100dvh 가 키보드까지 반영해
  // 아래의 visualViewport 보정이 아예 필요 없어진다. iOS 는 아직 무시한다.
  interactiveWidget: "resizes-content",
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
            __html: `try{if(localStorage.getItem("possion.theme.v2")==="light")document.documentElement.dataset.theme="light"}catch(e){}`,
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
