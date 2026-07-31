"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type SignupState =
  | { error: string }
  | { ok: true; needsConfirmation: boolean }
  | null;

export async function signup(
  _prev: SignupState,
  formData: FormData
): Promise<SignupState> {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const passwordConfirm = String(formData.get("password_confirm") || "");
  const displayName = String(formData.get("display_name") || "").trim();

  if (!email || !password) {
    return { error: "Enter email and password." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== passwordConfirm) {
    return { error: "Passwords do not match." };
  }

  // Supabase 호출을 감싼다 — signInWithPassword 와 같은 이유(reference
  // 234203017). redirect() 는 이 try 블록 **밖에서** 부른다: redirect() 는
  // NEXT_REDIRECT 라는 제어 흐름 신호를 예외로 던지는데, try/catch 안에
  // 있으면 그 신호까지 여기서 삼켜져 "가입 성공 후 이동" 이 "가입 실패"
  // 메시지로 둔갑한다.
  let session: { needsConfirmation: boolean } | null = null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName || null },
      },
    });

    if (error) {
      if (error.message.toLowerCase().includes("already")) {
        return { error: "This email is already registered." };
      }
      return { error: "Sign-up failed. Please try again shortly." };
    }

    session = data.session ? { needsConfirmation: false } : { needsConfirmation: true };
  } catch (e) {
    console.error("[auth:signup] unexpected failure:", e instanceof Error ? e.message : e);
    return { error: "Something went wrong on our end. Please try again in a moment." };
  }

  // 세션이 즉시 발급되면(이메일 확인 비활성) 바로 대시보드로.
  if (!session.needsConfirmation) {
    redirect("/dashboard");
  }

  // 이메일 확인이 필요한 경우.
  return { ok: true, needsConfirmation: true };
}
