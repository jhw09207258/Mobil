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
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
    }
  );
});
