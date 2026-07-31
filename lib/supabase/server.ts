import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Database } from "@/lib/database.types";

/**
 * 서버 컴포넌트 / 서버 액션 / 라우트 핸들러에서 사용하는 Supabase 클라이언트.
 * Next.js 의 cookie store 를 통해 세션을 읽고 갱신한다.
 *
 * `cache()` 로 감싸 **요청 한 건 안에서는 클라이언트를 하나만** 만든다.
 * 레이아웃·페이지·각 서버 컴포넌트가 저마다 createClient() 를 부르는데,
 * 매번 새로 만들면 쿠키를 다시 읽고 내부 fetch 상태(GoTrue 토큰 캐시 포함)를
 * 공유하지 못해 같은 인증 왕복을 여러 번 하게 된다. cache() 의 범위는 요청
 * 하나이므로 사용자 간에 클라이언트가 섞이지 않는다.
 */
export const createClient = cache(async function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // lib/supabase/middleware.ts 는 이 두 값이 없는 경우를 이미 방어한다 — 없으면
  // 보호된 경로만 /login 으로 보내고 사이트 전체가 500 이 되는 것을 막는다.
  // 그런데 이 클라이언트는 미들웨어를 통과한 뒤에도 모든 Server Action·Server
  // Component 에서 다시 만들어진다. 여기서 같은 검사를 하지 않으면
  // @supabase/ssr 안쪽에서 "Your project's URL and Key are required..." 라는
  // 뜻 모를 오류가 나고, 그 오류를 잡는 모든 곳(로그인·가입·requireUser 등,
  // v1.6.5/v1.6.6 에서 던지지 않게 고친 자리들)이 "환경변수가 없다" 는 실제
  // 원인을 log 로만 겨우 알 수 있는 채로 실패한다 — 배포 환경에 이 두 값이
  // 빠져 있으면 로그인이 이유도 안 보인 채 매번 "Something went wrong on
  // our end" 만 반환하는 것이 바로 이 경로다. 여기서 미리 걸러 로그에 원인을
  // 명확히 남긴다(값 자체는 절대 남기지 않는다 — 존재 여부만).
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "[possion] NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY 가 설정되지 않았다 — " +
        "이 배포 환경(Preview/Production)의 Vercel 프로젝트 설정에 두 값이 있는지 확인할 것. /api/health 로도 확인 가능."
    );
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // 서버 컴포넌트에서 호출된 경우 set 이 불가능할 수 있다.
          // 세션 갱신은 middleware 가 담당하므로 무시해도 안전하다.
        }
      },
    },
  });
});
