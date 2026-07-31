"use server";

import { createClient } from "@/lib/supabase/server";

export type AuthState = { error: string } | { ok: true; redirectTo: string } | null;

export async function login(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const redirectTo = String(formData.get("redirect") || "/dashboard");
  const safeRedirect = redirectTo.startsWith("/") ? redirectTo : "/dashboard";

  if (!email || !password) {
    return { error: "Enter email and password." };
  }

  // Supabase 로 가는 모든 호출을 감싼다. 이 액션은 로그인 화면의 유일한
  // 진입점이라, 어느 한 호출이 던지면(네트워크 순간 장애, DNS 실패 등)
  // Server Action 의 미처리 예외가 되어 (auth)/error.tsx 로 튀고 사용자는
  // "Sign-in screen could not load" 만 본다 — 로그인 실패보다 훨씬 나쁘다.
  // 아래 있던 세 호출(로그인·프로필 조회·로그아웃) 중 어느 것도 원래
  // 감싸여 있지 않았다(reference 234203017 로 배포 후 보고됨).
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.user) {
      return { error: "Invalid email or password." };
    }

    // 로그인 성공 자체와, 그 계정의 프로필 레코드가 실제로 온전한지는 별개다 —
    // 프로필은 auth.users 트리거로 항상 만들어지지만 복제 지연/트리거 실패 등
    // 드문 경우 비어 있을 수 있다. 그런 상태로 그냥 들여보내면 대시보드에서
    // 알 수 없는 오류로 막히므로, 로그인 시점에 미리 확인해 문제가 있으면
    // 세션을 되돌리고 명확한 이유를 알려준다 — "Authorizing…" 동안 실제로
    // 수행되는 검증이다.
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("id, email, approval_status")
      .eq("id", data.user.id)
      .single();

    if (profileErr || !profile || !profile.id || !profile.approval_status) {
      await supabase.auth.signOut().catch(() => {});
      return { error: "We couldn't verify your account information. Please try again." };
    }

    return { ok: true, redirectTo: safeRedirect };
  } catch (e) {
    console.error("[auth:login] unexpected failure:", e instanceof Error ? e.message : e);
    return { error: "Something went wrong on our end. Please try again in a moment." };
  }
}
