"use server";

import { createClient } from "@/lib/supabase/server";
import type { ApprovalStatus, Role } from "@/lib/database.types";

export type PendingUserRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  approval_status: ApprovalStatus;
  created_at: string;
};

/** 승인 대기(기본값)/승인됨/거절됨 사용자 목록 (관리자 전용, RPC 내부에서 재검증). */
export async function listUsersByApproval(
  status: ApprovalStatus | null = "pending"
): Promise<PendingUserRow[] | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_users_by_approval", {
    p_status: status,
  });
  if (error) return { error: "Failed to load users. Check admin privileges." };
  return data ?? [];
}

export async function approveUser(userId: string): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_user", { p_user_id: userId });
  if (error) return { error: "Failed to approve user." };
  return { ok: true };
}

export async function rejectUser(userId: string): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_user", { p_user_id: userId });
  if (error) return { error: "Failed to reject user." };
  return { ok: true };
}

export async function generateAdminCode(
  expiresAt: string | null
): Promise<{ code: string } | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("generate_admin_code", {
    p_expires_at: expiresAt,
  });

  if (error || !data) {
    return { error: "Failed to issue code. Check admin privileges." };
  }
  return { code: data as string };
}

/** 사용자 계정 삭제(관리자 전용). auth.users 삭제가 profiles 및 소유 콘텐츠까지 연쇄 삭제한다. */
export async function deleteUser(userId: string): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_user", { p_user_id: userId });
  if (error) {
    if (error.message.includes("cannot_delete_self")) {
      return { error: "You cannot delete your own account." };
    }
    return { error: "Failed to delete user." };
  }
  return { ok: true };
}

export type OrphanedMediaRow = { name: string; bytes: number; created_at: string };

/** 어떤 문서에도 참조되지 않는 media 버킷 오브젝트를 찾는다(관리자 전용). */
export async function listOrphanedMedia(): Promise<
  { rows: OrphanedMediaRow[] } | { error: string }
> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_orphaned_media");
  if (error) return { error: "Failed to scan media. Check admin privileges." };
  return { rows: data ?? [] };
}

/** 스캔된 고아 오브젝트를 Storage API 로 삭제한다(직접 SQL DELETE 는 보호 트리거로 차단됨). */
export async function deleteOrphanedMedia(
  names: string[]
): Promise<{ removed: number } | { error: string }> {
  if (names.length === 0) return { removed: 0 };
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("media").remove(names);
  if (error) return { error: "Failed to delete media objects." };
  return { removed: data?.length ?? 0 };
}

/**
 * 알림 발송기 토큰 — 관리자만. RPC 안에서 한 번 더 관리자 여부를 확인한다.
 * `p_rotate` 가 true 면 새 값을 만들고 옛 값은 즉시 죽는다.
 */
export async function getNotifyDispatchToken(
  rotate = false
): Promise<{ token: string } | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_dispatch_token", { p_rotate: rotate });
  if (error || !data) {
    return { error: "Only administrators can read the dispatch token." };
  }
  return { token: data };
}
