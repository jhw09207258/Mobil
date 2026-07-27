import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";

/**
 * 모든 요청에서 Supabase 세션을 갱신하고, 보호된 경로 접근을 통제한다.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname === "/login" || pathname === "/signup";
  // ICS 구독 피드는 로그인 없이 열려야 한다 — Google/Apple 캘린더가 우리
  // 세션 쿠키를 갖고 올 리가 없다. 인증은 그 라우트가 쿼리의 토큰으로 직접
  // 한다(app/api/calendar/feed/route.ts). 여기서 막으면 캘린더 앱이 로그인
  // 화면 HTML 을 받아 가 구독이 통째로 실패한다.
  const isFeedRoute = pathname === "/api/calendar/feed";
  const isPublicRoute =
    pathname === "/" || isAuthRoute || isFeedRoute || pathname.startsWith("/auth");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // 환경 변수가 없으면 createServerClient 가 즉시 예외를 던져 미들웨어가 죽고
  // (모든 경로에 매칭되므로) 사이트 전체가 500 이 된다. 배포 환경 변수 설정
  // 누락은 흔한 실수이므로, 공개 경로는 그대로 통과시키고 보호된 경로만
  // 안전하게 로그인으로 보낸다.
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error(
      "[middleware] NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY 가 설정되지 않았습니다."
    );
    if (!isPublicRoute) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("redirect", pathname);
      return NextResponse.redirect(url);
    }
    return response;
  }

  let user;
  let supabase: ReturnType<typeof createServerClient<Database>>;
  try {
    supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    });

    ({
      data: { user },
    } = await supabase.auth.getUser());
  } catch (error) {
    // Supabase 연결 실패(네트워크 오류, 잘못된 URL 등)로 미들웨어가 죽어
    // 사이트 전체가 500 이 되는 것을 방지한다.
    console.error("[middleware] Supabase 세션 확인 실패:", error);
    if (!isPublicRoute) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("redirect", pathname);
      return NextResponse.redirect(url);
    }
    return response;
  }

  // 미인증 사용자가 보호된 경로 접근 → 로그인으로
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  // 인증된 사용자가 로그인/가입 페이지 접근 → 대시보드로
  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // 승인 대기/거절 사용자는 대기 화면 밖 어디도 못 가게 한다.
  //
  // app/(app)/layout.tsx 도 같은 검사를 하지만, 그건 "페이지 렌더링"만
  // 가로막는다. Server Action 은 그 레이아웃을 다시 거치지 않고 클라이언트
  // 번들에서 곧장 서버로 가는 별도의 POST 라서, 이미 세션을 쥔 대기/거절
  // 사용자가 브라우저 탭을 새로고침하지 않은 채 액션을 계속 부르면 그
  // 레이아웃의 리다이렉트를 아예 거치지 않는다 — API 라우트도 마찬가지다.
  // 미들웨어는 정적 자산을 뺀 모든 요청(페이지·Server Action·API 라우트)을
  // 거치므로, 여기서 한 번만 막으면 그 경로들이 전부 함께 막힌다.
  if (user && !isPublicRoute && pathname !== "/pending-approval") {
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("approval_status")
        .eq("id", user.id)
        .single();
      // 프로필 행이 아직 없으면(가입 트리거 복제 지연) 승인 여부를 알 수
      // 없다 — lib/auth.ts 의 requireUser() 폴백과 같은 원칙으로, 불명확할
      // 때는 통과시키지 않고 막는 쪽을 택한다.
      if (profile?.approval_status !== "approved") {
        const url = request.nextUrl.clone();
        url.pathname = "/pending-approval";
        return NextResponse.redirect(url);
      }
    } catch (error) {
      // 이 조회 하나가 실패했다고(네트워크 오류 등) 미들웨어가 죽어 요청마다
      // 매칭되는 사이트 전체가 500 이 되면 안 된다. 여기서는 이 요청 하나만
      // 놓치고 지나간다 — 아래 auth.getUser() 실패 시의 fail-closed 와 달리,
      // 이 경로가 자주 실패하면 이미 승인된 사용자 전원이 오도가도 못 하게
      // 되는 대가가 더 크다.
      console.error("[middleware] 승인 상태 확인 실패:", error);
    }
  }

  return response;
}
