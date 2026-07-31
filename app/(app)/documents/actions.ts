"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser as requireUser } from "@/lib/auth";
import type { Json, DocVisibility } from "@/lib/database.types";
import { extractDocLinks } from "@/lib/ontology-links";
import { extractTagsFromText, extractTiptapPlainText } from "@/lib/tags";
import { syncObjectEmbedding } from "@/lib/embeddings";
import { listContributors } from "../contributors/actions";
import { listRepositories, getItemRepository } from "../repositories/actions";
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
    const plain = extractTiptapPlainText(imported.content);
    const tags = extractTagsFromText(`${data.title} ${plain}`);
    await supabase
      .rpc("sync_object_tags", { p_kind: "document", p_id: data.id, p_tag_names: tags })
      .then(
        () => {},
        () => {}
      );
    await syncObjectEmbedding(supabase, "document", data.id, data.title, plain);
  });

  return {
    id: data.id,
    title: data.title,
    seed: {
      id: data.id,
      title: data.title,
      content: data.content,
      initialYjsState: null,
      visibility: "private" as DocVisibility,
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
      visibility: "private" as DocVisibility,
      canEdit: true,
      isOwner: true,
      myShareId: user.id,
      myName: user.email ?? "",
      myAvatarUrl: null,
    },
  };
}

/**
 * 탭 시스템용: 문서 데이터 + 편집 가능 여부를 한 번에 조회.
 *
 * 에디터 상단바의 ContributorBadges/RepositoryPicker 는 원래 각자 마운트
 * 시점에 스스로 불러왔다 — 문서 하나를 열 때마다 이 서버 왕복(문서 본문)
 * 뒤에 클라이언트발 왕복이 두 번 더 따라붙는 셈이었다(기여자 목록, 저장소
 * 목록+현재 배정). "문서를 열 때 필요한 것 대부분을 한 번에" 원칙에 따라
 * 여기서 같이 가져와 그 두 번을 없앤다 — Promise.all 로 병렬화하므로 지연은
 * 겹치고, 별도 요청 두 번이 사라지는 이득만 남는다.
 */
export async function getDocumentForTab(id: string) {
  const { userId, profile } = await requireUser();
  const supabase = await createClient();

  const { data: doc } = await supabase
    .from("documents")
    .select("id, owner_id, title, content, visibility, updated_at, yjs_state")
    .eq("id", id)
    .single();

  if (!doc) return null;

  // documents_update RLS(0074)와 같은 모양으로 판정한다: 소유자는 언제나,
  // 'owner' 단계가 아니면 공개거나 관리자거나 명시적 edit 공유를 받은 경우.
  // 'owner' 단계는 소유자 본인 외에는 관리자를 포함해 누구도 편집할 수 없다.
  let canEdit = doc.owner_id === userId;
  if (!canEdit && doc.visibility !== "owner") {
    canEdit = doc.visibility === "public" || profile.role === "admin";
  }
  const needsPermCheck = !canEdit && doc.visibility !== "owner";

  const [perm, contributors, repos, itemRepo] = await Promise.all([
    needsPermCheck
      ? supabase
          .from("document_permissions")
          .select("permission")
          .eq("document_id", id)
          .eq("user_id", userId)
          .maybeSingle()
      : Promise.resolve({ data: null as { permission: string } | null }),
    listContributors("document", id),
    listRepositories(),
    getItemRepository("document", id),
  ]);
  if (needsPermCheck) canEdit = perm.data?.permission === "edit";

  return {
    id: doc.id,
    title: doc.title,
    content: doc.content,
    initialYjsState: doc.yjs_state,
    visibility: doc.visibility,
    canEdit,
    isOwner: doc.owner_id === userId,
    contributors,
    repos,
    currentRepositoryId: itemRepo?.repositoryId ?? null,
    myShareId: userId,
    myName: profile.display_name || profile.email,
    myAvatarUrl: profile.avatar_url,
  };
}

/** 제목/콘텐츠 저장. content 는 Tiptap JSON. yjsState 는 실시간 동시편집용
 * Yjs 스냅샷(base64, Y.encodeStateAsUpdate) — 다음 접속자가 이 시점부터
 * 이어서 동기화할 수 있도록 저장해둔다. */
export type DocumentActivity = {
  id: string;
  user_id: string;
  user_name: string;
  avatar_url: string | null;
  added: number;
  removed: number;
  preview: string | null;
  created_at: string;
};

export async function getDocumentActivity(docId: string): Promise<DocumentActivity[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_document_activity", { p_doc: docId });
  return data ?? [];
}

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

  // 활동 로그용: 업데이트 전의 본문을 미리 읽어 diff(추가/삭제 글자수)를 낸다.
  const { data: prevRow } = await supabase
    .from("documents")
    .select("content")
    .eq("id", id)
    .maybeSingle();
  const prevPlain = prevRow ? extractTiptapPlainText(prevRow.content) : "";

  const { data: saved, error } = await supabase
    .from("documents")
    .update({
      title: title.trim() || "Untitled",
      content,
      ...(yjsState !== undefined ? { yjs_state: yjsState } : {}),
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  // RLS 가 조용히 0행을 매칭시킬 수 있다(권한이 그새 회수됐거나 문서가
  // 지워진 경우) — PostgREST 는 그걸 에러로 안 주므로, 실제로 쓴 행이
  // 있는지 select 로 직접 확인해야 한다. 안 그러면 편집기가 "저장됨"을
  // 보여주면서 아무것도 저장되지 않는다.
  if (error || !saved) return { ok: false, error: "Save failed — you may no longer have access." };

  // 감사 로그·온톨로지 링크 동기화는 저장 완료 응답을 막지 않도록 응답 이후에 처리한다.
  after(async () => {
    // 편집 활동(추가/삭제 글자수) 기록 — 공통 접두/접미를 제거한 중간 구간으로
    // 추정한다(단일 영역 편집에 잘 맞는 저렴한 diff).
    const newPlain = extractTiptapPlainText(content);
    if (newPlain !== prevPlain) {
      let s = 0;
      while (s < prevPlain.length && s < newPlain.length && prevPlain[s] === newPlain[s]) s++;
      let eo = prevPlain.length;
      let en = newPlain.length;
      while (eo > s && en > s && prevPlain[eo - 1] === newPlain[en - 1]) {
        eo--;
        en--;
      }
      const removed = eo - s;
      const added = en - s;
      const preview = newPlain.slice(s, Math.min(en, s + 80)).trim();
      await supabase
        .rpc("log_document_activity", { p_doc: id, p_added: added, p_removed: removed, p_preview: preview })
        .then(
          () => {},
          () => {}
        );
    }
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
    const plain = extractTiptapPlainText(content);
    const tags = extractTagsFromText(`${title} ${plain}`);
    await supabase
      .rpc("sync_object_tags", { p_kind: "document", p_id: id, p_tag_names: tags })
      .then(
        () => {},
        () => {}
      );
    await syncObjectEmbedding(supabase, "document", id, title, plain);
  });

  return { ok: true };
}

export async function deleteDocument(id: string): Promise<ActionResult> {
  // 영구 삭제가 아니라 휴지통으로 이동한다(18시간 뒤 자동 삭제).
  // 링크·태그·임베딩은 여기서 지우지 않는다 — 복원했을 때 그대로 살아 있어야
  // 하므로, 정리는 영구 삭제 시점(purge_expired_trash / purge_trash_item)에
  // 한 번만 이루어진다.
  const supabase = await createClient();
  const { error } = await supabase.rpc("move_to_trash", { p_kind: "document", p_id: id });
  if (error) return { ok: false, error: "Delete failed." };
  return { ok: true };
}

/** 프라이버시 레벨 변경 — owner(소유자만, 관리자도 못 봄) / private / public. */
export async function setDocumentVisibility(
  id: string,
  visibility: DocVisibility
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("documents").update({ visibility }).eq("id", id);
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

  // document_permissions_insert RLS(0074)는 소유자 본인이면 owner 단계 문서에도
  // 행을 넣는 것 자체는 막지 않는다(무해하다 — documents_select 가 어차피 그
  // 공유를 무시한다). 하지만 그러면 "공유했는데 상대가 못 본다"는 혼란스러운
  // 결과만 남으므로, 여기서 미리 막아 이유를 알려준다.
  const { data: target } = await supabase
    .from("documents")
    .select("visibility")
    .eq("id", documentId)
    .maybeSingle();
  if (target?.visibility === "owner") {
    return {
      ok: false,
      error: "Owner-only documents can't be shared — switch visibility first.",
    };
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
