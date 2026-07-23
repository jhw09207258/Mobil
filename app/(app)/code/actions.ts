"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { detectLanguage, isLangKey } from "@/lib/languages";
import { extractTagsFromText } from "@/lib/tags";
import { syncObjectEmbedding } from "@/lib/embeddings";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** 탭 시스템용: 리다이렉트 없이 새 코드 파일을 만들고 id/name 만 반환. */
export async function createCodeFileTab(): Promise<{
  id: string;
  title: string;
  seed: unknown;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Authentication required.");

  const { data, error } = await supabase
    .from("code_files")
    .insert({ owner_id: user.id, name: "untitled.txt", language: "plaintext" })
    .select("id, name, language, content")
    .single();

  if (error || !data) throw new Error("Failed to create code file.");

  after(() =>
    supabase.from("audit_logs").insert({
      user_id: user.id,
      target_type: "code",
      target_id: data.id,
      action: "create",
    })
  );

  return {
    id: data.id,
    title: data.name,
    seed: {
      id: data.id,
      name: data.name,
      language: data.language,
      content: data.content,
      initialYjsState: null,
      isPublic: false,
      canEdit: true,
      isOwner: true,
      myShareId: user.id,
      myName: user.email ?? "",
      myAvatarUrl: null,
    },
  };
}

/** 탭 시스템용: 코드 파일 데이터 + 편집 가능 여부를 한 번에 조회. */
export async function getCodeFileForTab(id: string) {
  const { userId, profile } = await requireUser();
  const supabase = await createClient();

  const { data: file } = await supabase
    .from("code_files")
    .select("id, owner_id, name, language, content, is_public, updated_at, yjs_state")
    .eq("id", id)
    .single();

  if (!file) return null;

  let canEdit = file.owner_id === userId || profile.role === "admin" || file.is_public;
  if (!canEdit) {
    const { data: perm } = await supabase
      .from("code_file_permissions")
      .select("permission")
      .eq("code_file_id", id)
      .eq("user_id", userId)
      .maybeSingle();
    canEdit = perm?.permission === "edit";
  }

  return {
    id: file.id,
    name: file.name,
    language: file.language,
    content: file.content,
    initialYjsState: file.yjs_state,
    isPublic: file.is_public,
    canEdit,
    isOwner: file.owner_id === userId,
    myShareId: userId,
    myName: profile.display_name || profile.email,
    myAvatarUrl: profile.avatar_url,
  };
}

/** 이름/언어/콘텐츠 저장. yjsState 는 실시간 동시편집용 Yjs 스냅샷(base64). */
export async function saveCodeFile(
  id: string,
  name: string,
  language: string,
  content: string,
  yjsState?: string | null
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Authentication required." };

  const lang = isLangKey(language) ? language : "plaintext";
  const finalName = name.trim() || "untitled.txt";

  const { error } = await supabase
    .from("code_files")
    .update({
      name: finalName,
      language: lang,
      content,
      ...(yjsState !== undefined ? { yjs_state: yjsState } : {}),
    })
    .eq("id", id);

  if (error) return { ok: false, error: "Save failed." };

  after(async () => {
    await supabase.from("audit_logs").insert({
      user_id: user.id,
      target_type: "code",
      target_id: id,
      action: "update",
    });
    const tags = extractTagsFromText(finalName);
    await supabase
      .rpc("sync_object_tags", { p_kind: "code", p_id: id, p_tag_names: tags })
      .then(
        () => {},
        () => {}
      );
    await syncObjectEmbedding(supabase, "code", id, finalName, content);
  });

  return { ok: true };
}

export async function deleteCodeFile(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("code_files").delete().eq("id", id);
  if (error) return { ok: false, error: "Delete failed." };
  after(async () => {
    await supabase.rpc("cleanup_object_links", { p_kind: "code", p_id: id }).then(
      () => {},
      () => {}
    );
    await supabase.rpc("cleanup_object_tags", { p_kind: "code", p_id: id }).then(
      () => {},
      () => {}
    );
  });
  return { ok: true };
}

export async function setCodeFilePublic(
  id: string,
  isPublic: boolean
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("code_files")
    .update({ is_public: isPublic })
    .eq("id", id);
  if (error) return { ok: false, error: "Update failed." };
  return { ok: true };
}

/** 파일명 확장자로 언어 자동 추정 (편의 기능). */
export async function suggestLanguage(name: string): Promise<string> {
  return detectLanguage(name);
}

export async function shareCodeFile(
  codeFileId: string,
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

  const { error } = await supabase.from("code_file_permissions").upsert(
    {
      code_file_id: codeFileId,
      user_id: id,
      permission,
      granted_by: user.id,
    },
    { onConflict: "code_file_id,user_id" }
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

export async function revokeCodeFileShare(
  permissionId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("code_file_permissions")
    .delete()
    .eq("id", permissionId);
  if (error) return { ok: false, error: "Failed to revoke." };
  return { ok: true };
}

export async function listCodeFileShares(codeFileId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("code_file_permissions")
    .select("id, user_id, permission, granted_at")
    .eq("code_file_id", codeFileId)
    .order("granted_at", { ascending: true });
  return data ?? [];
}
