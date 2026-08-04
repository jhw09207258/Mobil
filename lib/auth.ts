import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isNextControlFlowError } from "@/lib/next-control-flow";
import type { Database } from "@/lib/database.types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/**
 * 현재 인증된 사용자와 프로필을 반환한다. 미인증 시 로그인으로 리다이렉트.
 * 프로필은 auth.users 트리거(0003)로 항상 존재하지만, 복제 지연 등에 대비해
 * 이메일 폴백을 둔다.
 *
 * ── 왜 cache() 로 감쌌는가 ──────────────────────────────────────────────────
 * 이 함수는 호출마다 **직렬 네트워크 왕복 두 번**을 한다: auth.getUser() 는
 * GoTrue 에 실제로 요청을 보내고(로컬 토큰 해독이 아니다), 그 다음 프로필을
 * PostgREST 에서 읽는다. 그런데 화면 한 장을 그릴 때 이 함수는 여러 번 불린다
 * — 레이아웃에서 한 번, 페이지에서 한 번, 그 페이지가 쓰는 서버 컴포넌트마다
 * 또 한 번. /dashboard 는 레이아웃+페이지만 해도 두 번이라 왕복 4번이었다.
 *
 * 같은 요청 안에서 같은 답이 나올 수밖에 없는 조회다. cache() 의 수명은 요청
 * 하나이므로 사용자끼리 섞이지 않고, 세션이 바뀌면 다음 요청에서 다시 읽는다.
 * 꼬리(p99)에서 특히 크다 — 직렬 왕복이 하나 줄면 "그중 하나가 느릴 확률"이
 * 통째로 사라지기 때문이다.
 */
export const requireUser = cache(async function requireUser(): Promise<{
  userId: string;
  email: string;
  profile: Profile;
  /** 프로필 행을 실제로 못 읽어 아래의 임시값을 지어낸 경우 true.
   *  이때 profile 의 필드들은 "모른다"는 뜻이지 사실이 아니다 — 그 값으로
   *  사용자를 어딘가로 보내기 전에 반드시 확인할 것. */
  profileMissing: boolean;
}> {
  let supabase;
  let user;
  try {
    supabase = await createClient();
    ({
      data: { user },
    } = await supabase.auth.getUser());
  } catch (error) {
    if (isNextControlFlowError(error)) throw error;
    // Supabase 설정/연결 오류로 보호된 페이지 전체가 500 이 되는 대신
    // 로그인 화면으로 안전하게 보낸다.
    console.error("[requireUser] Supabase 세션 확인 실패:", error);
    redirect("/login");
  }

  if (!user) {
    redirect("/login");
  }

  // 위의 auth.getUser() 는 실패를 감싸 두었는데 이 조회는 그러지 않았다 —
  // 이 함수는 보호된 페이지 전부와 대기 화면이 공유하므로, Supabase 로 가는
  // 이 요청 하나가 네트워크 순간 장애로 던지면 그 페이지 전체가 죽었다
  // (reference 234203017 — 배포 후 "화면을 불러올 수 없습니다" 로 보고됨).
  // auth.getUser() 와 같은 원칙: 실패하면 "복제 지연으로 아직 안 보임" 과
  // 똑같이 취급해 대기 화면으로 보낸다. 승인 여부를 모를 땐 통과보다 대기가
  // 안전하다는 원칙은 아래 폴백과 이미 같다.
  let profile: Profile | null = null;
  try {
    ({ data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single());
  } catch (error) {
    if (isNextControlFlowError(error)) throw error;
    console.error("[requireUser] 프로필 조회 실패:", error);
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    profileMissing: !profile,
    profile:
      profile ??
      ({
        id: user.id,
        email: user.email ?? "",
        display_name: null,
        role: "user",
        // 트리거 복제 지연으로 프로필 행이 아직 안 보이는 극히 짧은 순간의
        // 임시 폴백이다 — 실제 승인 여부를 알 수 없으니 대기 화면으로
        // 보내는 쪽(오탐)이 잘못 통과시키는 쪽보다 안전하다.
        approval_status: "pending",
        approved_by: null,
        approved_at: null,
        avatar_url: null,
        age: null,
        address: null,
        gender: null,
        bio: null,
        phone: null,
        age_public: false,
        address_public: false,
        phone_public: false,
        active_team_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as Profile),
  };
});

/**
 * requireUser() + 승인 여부까지 강제한다.
 *
 * requireUser() 는 세션이 있는지만 본다 — 대기/거절 상태는 지금까지
 * app/(app)/layout.tsx 하나에서만 걸러 왔는데, 그건 "페이지 렌더링"만
 * 가로막을 뿐이다. Server Action 은 그 레이아웃을 다시 거치지 않고 클라이언트
 * 번들에서 직접 서버로 가는 별도의 POST 이므로, 이미 세션을 쥔 대기/거절
 * 사용자가 브라우저 탭을 새로고침하지 않고 그대로 액션을 계속 부르면
 * 레이아웃의 리다이렉트를 전혀 거치지 않는다. 모든 Server Action 은 이 함수를
 * 써야 한다 — 대기 화면 자신은 예외로 requireUser() 를 그대로 쓴다(안 그러면
 * 대기 화면이 자기 자신으로 리다이렉트를 반복한다).
 */
export async function requireApprovedUser(): Promise<{
  userId: string;
  email: string;
  profile: Profile;
}> {
  const result = await requireUser();
  if (result.profile.approval_status !== "approved") {
    redirect("/pending-approval");
  }
  return result;
}
