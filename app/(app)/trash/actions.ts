"use server";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";

export type TrashItem = {
  kind: string;
  id: string;
  title: string;
  deleted_at: string;
  expires_at: string;
  storage_path: string | null;
};

/** 내 휴지통 — RLS SELECT 정책이 삭제 항목을 가리므로 SECURITY DEFINER RPC 로 읽는다. */
export async function listTrash(): Promise<TrashItem[]> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_trash");
  return data ?? [];
}

export async function restoreItem(
  kind: string,
  id: string
): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("restore_from_trash", { p_kind: kind, p_id: id });
  if (error) return { error: "Restore failed — you may not own this item." };
  return { ok: true };
}

/** 즉시 영구 삭제. 파일은 스토리지 객체를 먼저 지운다 — DB 행이 사라지면
 *  경로를 잃어 고아 객체가 남는다. */
export async function purgeItem(
  kind: string,
  id: string,
  storagePath: string | null
): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  if (kind === "file" && storagePath) {
    await supabase.storage.from("files").remove([storagePath]);
  }
  const { error } = await supabase.rpc("purge_trash_item", { p_kind: kind, p_id: id });
  if (error) return { error: "Delete failed — you may not own this item." };
  return { ok: true };
}
