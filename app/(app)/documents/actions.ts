"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import type { Json } from "@/lib/database.types";
import { extractDocLinks } from "@/lib/ontology-links";
import { extractTagsFromText, extractTiptapPlainText } from "@/lib/tags";
import {
  importFileToTiptapDoc,
  tiptapToPlainText,
  tiptapToDocxBuffer,
  tiptapToPdfBytes,
  tiptapToHwpxBytes,
} from "@/lib/doc-convert";

export type ActionResult = { ok: true } | { ok: false; error: string };

const MAX_IMPORT_BYTES = 20 * 1024 * 1024; // 20MB

/** 외부 텍스트 파일(txt/docx/hwp/hwpx)을 읽어 새 문서로 만든다. */
export async function importDocument(
  formData: FormData
): Promise<{ id: string; title: string; seed: unknown } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Authentication required." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file provided." };
  if (file.size > MAX_IMPORT_BYTES) return { error: "File is too large (max 20MB)." };

  let imported;
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    imported = await importFileToTiptapDoc(file.name, bytes);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not read this file." };
  }

  const { data, error } = await supabase
    .from("documents")
    .insert({ owner_id: user.id, title: imported.title, content: imported.content })
    .select("id, title, content")
    .single();

  if (error || !data) return { error: "Failed to create document." };

  after(async () => {
    await supabase.from("audit_logs").insert({
      user_id: user.id,
      target_type: "document",
      target_id: data.id,
      action: "create",
    });
    const tags = extractTagsFromText(`${data.title} ${extractTiptapPlainText(imported.content)}`);
    await supabase
      .rpc("sync_object_tags", { p_kind: "document", p_id: data.id, p_tag_names: tags })
      .then(
        () => {},
        () => {}
      );
  });

  return {
    id: data.id,
    title: data.title,
    seed: {
      id: data.id,
      title: data.title,
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

export type DocExportFormat = "txt" | "docx" | "pdf" | "hwpx";

const EXPORT_MIME: Record<DocExportFormat, string> = {
  txt: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  hwpx: "application/haansofthwpx",
};

/** 문서를 txt/docx/pdf/hwpx 로 내보낸다. base64 로 반환해 클라이언트에서 다운로드시킨다. */
export async function exportDocument(
  id: string,
  format: DocExportFormat
): Promise<{ fileName: string; mimeType: string; base64: string } | { error: string }> {
  const supabase = await createClient();
  const { data: doc, error } = await supabase
    .from("documents")
    .select("title, content")
    .eq("id", id)
    .single();
  if (error || !doc) return { error: "Document not found." };

  const title = doc.title || "Untitled";
  const safeName = title.replace(/[^\w.\-() ]+/g, "_") || "document";

  try {
    let bytes: Buffer | Uint8Array;
    if (format === "txt") bytes = Buffer.from(tiptapToPlainText(doc.content), "utf-8");
    else if (format === "docx") bytes = await tiptapToDocxBuffer(doc.content, title);
    else if (format === "pdf") bytes = await tiptapToPdfBytes(doc.content, title);
    else bytes = await tiptapToHwpxBytes(doc.content, title);

    return {
      fileName: `${safeName}.${format}`,
      mimeType: EXPORT_MIME[format],
      base64: Buffer.from(bytes).toString("base64"),
    };
  } catch {
    return { error: "Export failed." };
  }
}

/** 탭 시스템용: 리다이렉트 없이 새 문서를 만들고 id/title 만 반환. */
export async function createDocumentTab(): Promise<{
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
    .from("documents")
    .insert({ owner_id: user.id, title: "Untitled" })
    .select("id, title, content")
    .single();

  if (error || !data) throw new Error("Failed to create document.");

  // 감사 로그는 탭이 열리는 응답 속도에 영향이 없도록 응답 전송 이후에 기록한다.
  after(() =>
    supabase.from("audit_logs").insert({
      user_id: user.id,
      target_type: "document",
      target_id: data.id,
      action: "create",
    })
  );

  return {
    id: data.id,
    title: data.title,
    // 이미 알고 있는 데이터라 TabContent 가 getDocumentForTab 을 또 호출하지
    // 않도록 그대로 시드로 넘긴다(getDocumentForTab 과 동일한 모양).
    seed: {
      id: data.id,
      title: data.title,
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

/** 탭 시스템용: 문서 데이터 + 편집 가능 여부를 한 번에 조회. */
export async function getDocumentForTab(id: string) {
  const { userId, profile } = await requireUser();
  const supabase = await createClient();

  const { data: doc } = await supabase
    .from("documents")
    .select("id, owner_id, title, content, is_public, updated_at, yjs_state")
    .eq("id", id)
    .single();

  if (!doc) return null;

  let canEdit = doc.owner_id === userId || profile.role === "admin" || doc.is_public;
  if (!canEdit) {
    const { data: perm } = await supabase
      .from("document_permissions")
      .select("permission")
      .eq("document_id", id)
      .eq("user_id", userId)
      .maybeSingle();
    canEdit = perm?.permission === "edit";
  }

  return {
    id: doc.id,
    title: doc.title,
    content: doc.content,
    initialYjsState: doc.yjs_state,
    isPublic: doc.is_public,
    canEdit,
    isOwner: doc.owner_id === userId,
    myShareId: userId,
    myName: profile.display_name || profile.email,
    myAvatarUrl: profile.avatar_url,
  };
}

/** 제목/콘텐츠 저장. content 는 Tiptap JSON. yjsState 는 실시간 동시편집용
 * Yjs 스냅샷(base64, Y.encodeStateAsUpdate) — 다음 접속자가 이 시점부터
 * 이어서 동기화할 수 있도록 저장해둔다. */
export async function saveDocument(
  id: string,
  title: string,
  content: Json,
  yjsState?: string | null
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Authentication required." };

  const { error } = await supabase
    .from("documents")
    .update({
      title: title.trim() || "Untitled",
      content,
      ...(yjsState !== undefined ? { yjs_state: yjsState } : {}),
    })
    .eq("id", id);

  if (error) return { ok: false, error: "Save failed." };

  // 감사 로그·온톨로지 링크 동기화는 저장 완료 응답을 막지 않도록 응답 이후에 처리한다.
  after(async () => {
    await supabase.from("audit_logs").insert({
      user_id: user.id,
      target_type: "document",
      target_id: id,
      action: "update",
    });
    await supabase
      .rpc("sync_object_links", {
        p_source: `doc:${id}`,
        p_from_kind: "document",
        p_from_id: id,
        p_links: extractDocLinks(content),
      })
      .then(
        () => {},
        () => {}
      );
    const tags = extractTagsFromText(`${title} ${extractTiptapPlainText(content)}`);
    await supabase
      .rpc("sync_object_tags", { p_kind: "document", p_id: id, p_tag_names: tags })
      .then(
        () => {},
        () => {}
      );
  });

  return { ok: true };
}

export async function deleteDocument(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) return { ok: false, error: "Delete failed." };
  after(async () => {
    await supabase.rpc("cleanup_object_links", { p_kind: "document", p_id: id }).then(
      () => {},
      () => {}
    );
    await supabase.rpc("cleanup_object_tags", { p_kind: "document", p_id: id }).then(
      () => {},
      () => {}
    );
  });
  return { ok: true };
}

/** 공개 여부 토글. */
export async function setDocumentPublic(
  id: string,
  isPublic: boolean
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("documents")
    .update({ is_public: isPublic })
    .eq("id", id);
  if (error) return { ok: false, error: "Update failed." };
  return { ok: true };
}

export async function shareDocument(
  documentId: string,
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

  const { error } = await supabase.from("document_permissions").upsert(
    {
      document_id: documentId,
      user_id: id,
      permission,
      granted_by: user.id,
    },
    { onConflict: "document_id,user_id" }
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

export async function revokeDocumentShare(
  permissionId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("document_permissions")
    .delete()
    .eq("id", permissionId);
  if (error) return { ok: false, error: "Failed to revoke." };
  return { ok: true };
}

export async function listDocumentShares(documentId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("document_permissions")
    .select("id, user_id, permission, granted_at")
    .eq("document_id", documentId)
    .order("granted_at", { ascending: true });
  return data ?? [];
}
