import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { buildSecurityHeaders } from "@/lib/security-headers";

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);
  for (const [key, value] of buildSecurityHeaders(request.nextUrl.pathname)) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  matcher: [
    /*
     * 다음을 제외한 모든 요청 경로에 적용:
     * - _next/static, _next/image (정적 자산)
     * - public/ 의 공개 파일 — 아이콘·이미지·서비스워커·매니페스트
     *
     * 여기서 빠뜨리면 조용히 크게 깨진다. 미들웨어는 미인증 요청을 /login 으로
     * 307 시키므로, 제외되지 않은 정적 파일은 **로그인 페이지 HTML** 을 받는다.
     *   * `/sw.js` 가 HTML 로 오면 브라우저가 MIME 타입을 이유로 서비스워커
     *     등록을 거부한다 → 웹 푸시가 통째로 동작하지 않는다.
     *   * `/manifest.json` 이 HTML 로 오면 PWA 설치 정보가 통째로 무시된다
     *     → iOS 는 홈 화면 설치가 푸시의 전제라 알림이 아예 불가능해진다.
     * 확장자만으로 거르던 기존 규칙에 `.json`/`.js` 가 없어 실제로 그렇게
     * 되어 있었다. 파일명을 직접 적어 다시 새지 않게 한다.
     */
    "/((?!_next/static|_next/image|favicon\\.ico|sw\\.js|manifest\\.json|browserconfig\\.xml|robots\\.txt|sitemap\\.xml|brand/|email/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|webmanifest)$).*)",
  ],
};
