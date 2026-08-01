"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractTagsFromText } from "@/lib/tags";

const BUCKET = "files";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** 서명된 다운로드 URL 발급 (유효시간 60초). */
export async function getSignedUrl(
  fileId: string
): Promise<{ url: string } | { error: string }> {
  const supabase = await createClient();

  const { data: file, error } = await supabase
    .from("files")
    .select("storage_path")
    .eq("id", fileId)
    .single();

  if (error || !file) return { error: "File not found." };

  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(file.storage_path, 60, { download: true });

  if (signErr || !signed) return { error: "Failed to create download link." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    after(() =>
      supabase.from("audit_logs").insert({
        user_id: user.id,
        target_type: "file",
        target_id: fileId,
        action: "download",
      })
    );
  }

  return { url: signed.signedUrl };
}

/** 파일 표시 이름 변경 (스토리지 경로는 유지, 메타데이터만 갱신). */
export async function renameFile(
  fileId: string,
  newName: string
): Promise<ActionResult> {
  const name = newName.trim();
  if (!name) return { ok: false, error: "Enter a name." };
  if (name.length > 255) return { ok: false, error: "Name is too long." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("files")
    .update({ file_name: name })
    .eq("id", fileId);

  if (error) return { ok: false, error: "Rename failed." };

  after(async () => {
    const tags = extractTagsFromText(name);
    await supabase.rpc("sync_object_tags", { p_kind: "file", p_id: fileId, p_tag_names: tags }).then(
      () => {},
      () => {}
    );
  });

  return { ok: true };
}

/** 스토리지 객체와 메타데이터 행을 함께 삭제. */
export async function deleteFile(fileId: string): Promise<ActionResult> {
  // 휴지통으로 이동 — 스토리지 객체와 링크·태그는 그대로 둔다. 복원하면
  // 파일이 다시 온전해야 하기 때문이며, 실제 삭제는 18시간 뒤
  // purge_expired_trash() 가 스토리지 객체까지 함께 정리한다.
  const supabase = await createClient();

  const { error } = await supabase.rpc("move_to_trash", {
    p_kind: "file",
    p_id: fileId,
  });
  if (error) return { ok: false, error: "Delete failed." };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  after(async () => {
    if (user) {
      await supabase.from("audit_logs").insert({
        user_id: user.id,
        target_type: "file",
        target_id: fileId,
        action: "delete",
      });
    }
  });

  return { ok: true };
}

/** 공유 대상(user UUID)에게 view/edit 권한 부여. */
export async function shareFile(
  fileId: string,
  recipientId: string,
  permission: "view" | "edit"
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Authentication required." };

  const id = recipientId.trim();
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(id)) {
    return { ok: false, error: "Not a valid Share ID (UUID)." };
  }
  if (id === user.id) {
    return { ok: false, error: "You can't share with yourself." };
  }

  // 팀이 다르면 file_permissions_insert RLS(0080)가 막는다 — 미리 확인해
  // 정확한 이유를 알려준다.
  const { data: sameTeam } = await supabase.rpc("shares_active_team", { p_other: id });
  if (!sameTeam) {
    return { ok: false, error: "You can only share with members of your current team." };
  }

  const { error } = await supabase.from("file_permissions").upsert(
    {
      file_id: fileId,
      user_id: id,
      permission,
      granted_by: user.id,
    },
    { onConflict: "file_id,user_id" }
  );

  if (error) {
    return {
      ok: false,
      error:
        "Failed to grant access. Check that the Share ID belongs to an existing user.",
    };
  }

  return { ok: true };
}

/** 공유 권한 회수. */
export async function revokeFileShare(
  permissionId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("file_permissions")
    .delete()
    .eq("id", permissionId);

  if (error) return { ok: false, error: "Failed to revoke." };
  return { ok: true };
}

/** 특정 파일의 공유 권한 목록 조회. */
export async function listFileShares(fileId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("file_permissions")
    .select("id, user_id, permission, granted_at")
    .eq("file_id", fileId)
    .order("granted_at", { ascending: true });
  return data ?? [];
}
