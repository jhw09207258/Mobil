"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import type { Json } from "@/lib/database.types";
import { extractTagsFromText } from "@/lib/tags";
import {
  importFileToSheetData,
  exportSheetToCsv,
  exportSheetToXlsxBuffer,
  exportSheetToPdfBytes,
} from "@/lib/sheet-convert";

export type ActionResult = { ok: true } | { ok: false; error: string };

const MAX_IMPORT_BYTES = 20 * 1024 * 1024; // 20MB

/** 외부 csv/xlsx 파일을 읽어 새 시트로 만든다. */
export async function importSheet(
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
    imported = await importFileToSheetData(file.name, bytes);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not read this file." };
  }

  const { data, error } = await supabase
    .from("sheets")
    .insert({ owner_id: user.id, title: imported.title, data: imported.data })
    .select("id, title, data")
    .single();

  if (error || !data) return { error: "Failed to create sheet." };

  after(async () => {
    const tags = extractTagsFromText(data.title);
    await supabase.rpc("sync_object_tags", { p_kind: "sheet", p_id: data.id, p_tag_names: tags }).then(
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
      data: data.data,
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

export type SheetExportFormat = "csv" | "xlsx" | "pdf";

const EXPORT_MIME: Record<SheetExportFormat, string> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

/** 시트를 csv/xlsx/pdf 로 내보낸다. base64 로 반환해 클라이언트에서 다운로드시킨다. */
export async function exportSheet(
  id: string,
  format: SheetExportFormat
): Promise<{ fileName: string; mimeType: string; base64: string } | { error: string }> {
  const supabase = await createClient();
  const { data: sheet, error } = await supabase
    .from("sheets")
    .select("title, data")
    .eq("id", id)
    .single();
  if (error || !sheet) return { error: "Sheet not found." };

  const title = sheet.title || "Untitled sheet";
  const safeName = title.replace(/[^\w.\-() ]+/g, "_") || "sheet";

  try {
    let bytes: Buffer | Uint8Array | string;
    if (format === "csv") bytes = exportSheetToCsv(sheet.data);
    else if (format === "xlsx") bytes = await exportSheetToXlsxBuffer(sheet.data);
    else bytes = await exportSheetToPdfBytes(sheet.data, title);

    const base64 =
      typeof bytes === "string" ? Buffer.from(bytes, "utf-8").toString("base64") : Buffer.from(bytes).toString("base64");

    return { fileName: `${safeName}.${format}`, mimeType: EXPORT_MIME[format], base64 };
  } catch {
    return { error: "Export failed." };
  }
}

/** 탭 시스템용: 리다이렉트 없이 새 시트를 만들고 id/title 만 반환. */
export async function createSheetTab(): Promise<{
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
    .from("sheets")
    .insert({ owner_id: user.id, title: "Untitled sheet" })
    .select("id, title, data")
    .single();

  if (error || !data) throw new Error("Failed to create sheet.");
  return {
    id: data.id,
    title: data.title,
    seed: {
      id: data.id,
      title: data.title,
      data: data.data,
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

/** 탭 시스템용: 시트 데이터 + 편집 가능 여부를 한 번에 조회. */
export async function getSheetForTab(id: string) {
  const { userId, profile } = await requireUser();
  const supabase = await createClient();

  const { data: sheet } = await supabase
    .from("sheets")
    .select("id, owner_id, title, data, is_public, updated_at, yjs_state")
    .eq("id", id)
    .single();

  if (!sheet) return null;

  let canEdit = sheet.owner_id === userId || profile.role === "admin" || sheet.is_public;
  if (!canEdit) {
    const { data: perm } = await supabase
      .from("sheet_permissions")
      .select("permission")
      .eq("sheet_id", id)
      .eq("user_id", userId)
      .maybeSingle();
    canEdit = perm?.permission === "edit";
  }

  return {
    id: sheet.id,
    title: sheet.title,
    data: sheet.data,
    initialYjsState: sheet.yjs_state,
    isPublic: sheet.is_public,
    canEdit,
    isOwner: sheet.owner_id === userId,
    myShareId: userId,
    myName: profile.display_name || profile.email,
    myAvatarUrl: profile.avatar_url,
  };
}

export async function saveSheet(
  id: string,
  title: string,
  data: Json,
  yjsState?: string | null
): Promise<ActionResult> {
  const supabase = await createClient();
  const finalTitle = title.trim() || "Untitled sheet";
  const { error } = await supabase
    .from("sheets")
    .update({
      title: finalTitle,
      data,
      ...(yjsState !== undefined ? { yjs_state: yjsState } : {}),
    })
    .eq("id", id);
  if (error) return { ok: false, error: "Save failed." };

  after(async () => {
    const tags = extractTagsFromText(finalTitle);
    await supabase.rpc("sync_object_tags", { p_kind: "sheet", p_id: id, p_tag_names: tags }).then(
      () => {},
      () => {}
    );
  });

  return { ok: true };
}

export async function deleteSheet(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("sheets").delete().eq("id", id);
  if (error) return { ok: false, error: "Delete failed." };
  after(async () => {
    await supabase.rpc("cleanup_object_links", { p_kind: "sheet", p_id: id }).then(
      () => {},
      () => {}
    );
    await supabase.rpc("cleanup_object_tags", { p_kind: "sheet", p_id: id }).then(
      () => {},
      () => {}
    );
  });
  return { ok: true };
}

export async function setSheetPublic(
  id: string,
  isPublic: boolean
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("sheets")
    .update({ is_public: isPublic })
    .eq("id", id);
  if (error) return { ok: false, error: "Update failed." };
  return { ok: true };
}

export async function shareSheet(
  sheetId: string,
  recipientId: string,
  permission: "view" | "edit"
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Authentication required." };
  const id = recipientId.trim();
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(id)) return { ok: false, error: "Not a valid Share ID (UUID)." };
  if (id === user.id) return { ok: false, error: "You can't share with yourself." };

  const { error } = await supabase.from("sheet_permissions").upsert(
    { sheet_id: sheetId, user_id: id, permission, granted_by: user.id },
    { onConflict: "sheet_id,user_id" }
  );
  if (error)
    return {
      ok: false,
      error: "Failed to grant access. Check that the Share ID belongs to an existing user.",
    };
  return { ok: true };
}

export async function revokeSheetShare(permissionId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("sheet_permissions")
    .delete()
    .eq("id", permissionId);
  if (error) return { ok: false, error: "Failed to revoke." };
  return { ok: true };
}

export async function listSheetShares(sheetId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sheet_permissions")
    .select("id, user_id, permission, granted_at")
    .eq("sheet_id", sheetId)
    .order("granted_at", { ascending: true });
  return data ?? [];
}
