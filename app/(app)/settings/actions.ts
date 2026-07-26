"use server";

import { createClient } from "@/lib/supabase/server";

export type SettingsState = { error: string } | { ok: true } | null;

/** 필수 입력 검증: 모든 프로필 필드는 빈칸을 허용하지 않는다(공개 여부와는 별개). */
export async function updateProfile(
  _prev: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const displayName = String(formData.get("display_name") || "").trim();
  const gender = String(formData.get("gender") || "").trim();
  const bio = String(formData.get("bio") || "").trim();
  const ageRaw = String(formData.get("age") || "").trim();
  const address = String(formData.get("address") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  const agePublic = formData.get("age_public") === "on";
  const addressPublic = formData.get("address_public") === "on";
  const phonePublic = formData.get("phone_public") === "on";

  if (!displayName || !gender || !bio || !ageRaw || !address || !phone) {
    return { error: "All fields are required — none can be left blank." };
  }
  if (displayName.length > 80) return { error: "Name is too long." };
  if (gender.length > 40) return { error: "Gender is too long." };
  if (bio.length > 500) return { error: "Bio is too long (max 500 characters)." };
  if (address.length > 300) return { error: "Address is too long." };
  if (phone.length > 40) return { error: "Phone number is too long." };

  const age = Number(ageRaw);
  if (!Number.isInteger(age) || age < 0 || age > 150) {
    return { error: "Enter a valid age (0–150)." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Authentication required." };

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName,
      gender,
      bio,
      age,
      address,
      phone,
      age_public: agePublic,
      address_public: addressPublic,
      phone_public: phonePublic,
    })
    .eq("id", user.id);

  if (error) return { error: "Failed to save." };
  return { ok: true };
}

export type PasswordState = { error: string } | { ok: true } | null;

/** 비밀번호 변경: 기존 비밀번호로 재인증에 성공해야만 새 비밀번호로 교체한다. */
export async function changePassword(
  _prev: PasswordState,
  formData: FormData
): Promise<PasswordState> {
  const currentPassword = String(formData.get("current_password") || "");
  const newPassword = String(formData.get("new_password") || "");
  const newPasswordConfirm = String(formData.get("new_password_confirm") || "");

  if (!currentPassword || !newPassword) {
    return { error: "Enter your current and new password." };
  }
  if (newPassword.length < 8) {
    return { error: "New password must be at least 8 characters." };
  }
  if (newPassword !== newPasswordConfirm) {
    return { error: "New passwords do not match." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Authentication required." };

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (signInError) return { error: "Current password is incorrect." };

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { error: "Failed to change password." };
  return { ok: true };
}

export async function setAvatarUrl(
  url: string
): Promise<{ ok: true } | { error: string }> {
  // 클라이언트가 넘기는 값이므로 우리 Supabase Storage 공개 URL 만 허용한다 —
  // 임의 외부/스킴 URL 이 프로필에 저장되는 것을 원천 차단(어차피 CSP 의
  // img-src 가 렌더링은 막지만, 저장 단계에서부터 거른다).
  const storageOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!storageOrigin || !url.startsWith(`${storageOrigin}/storage/v1/object/public/`)) {
    return { error: "Invalid avatar URL." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Authentication required." };

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: url })
    .eq("id", user.id);

  if (error) return { error: "Failed to save avatar." };
  return { ok: true };
}

export async function removeAvatar(): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Authentication required." };

  // 프로필의 avatar_url 을 비운다. 스토리지의 실제 오브젝트도 정리한다
  // (best-effort — 삭제 실패해도 프로필은 이미 사진 없음으로 표시된다).
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: null })
    .eq("id", user.id);
  if (error) return { error: "Failed to remove avatar." };

  for (const ext of ["jpg", "jpeg", "png", "webp", "gif"]) {
    await supabase.storage.from("avatars").remove([`${user.id}/avatar.${ext}`]).then(
      () => {},
      () => {}
    );
  }
  return { ok: true };
}

/** 새 채팅 메시지 이메일 알림 켜기/끄기. 자기 행만 RLS 로 바꿀 수 있다. */
export async function setChatEmailNotifications(
  enabled: boolean
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Authentication required." };

  const { error } = await supabase
    .from("profiles")
    .update({ email_chat_notifications: enabled })
    .eq("id", user.id);
  if (error) return { error: "Failed to save." };
  return { ok: true };
}
