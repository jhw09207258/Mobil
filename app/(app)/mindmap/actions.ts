"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import type { Json } from "@/lib/database.types";
import type { MindElixirData } from "mind-elixir";
import { extractMindmapLinks } from "@/lib/ontology-links";
import { extractTagsFromText, extractMindmapPlainText } from "@/lib/tags";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** 탭 시스템용: 리다이렉트 없이 새 마인드맵을 만들고 id/title 만 반환. */
export async function createMindMapTab(): Promise<{
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
    .from("mind_maps")
    .insert({ owner_id: user.id, title: "Untitled map" })
    .select("id, title, data, yjs_state")
    .single();

  if (error || !data) throw new Error("Failed to create map.");

  // 참조 노드 선택기가 필요로 하는 목록 — getMindMapForTab 과 동일하게 채워야
  // 시드가 완전한 대체물이 된다(그렇지 않으면 새 마인드맵에서 참조를 못 고름).
  const items = await listWorkspaceItems();

  return {
    id: data.id,
    title: data.title,
    seed: {
      id: data.id,
      title: data.title,
      data: data.data,
      initialYjsState: data.yjs_state,
      isPublic: false,
      canEdit: true,
      isOwner: true,
      myShareId: user.id,
      items,
    },
  };
}

/** MindMup outline HTML 등 외부 파일에서 클라이언트가 이미 Mind Elixir 트리로
 * 파싱해온 데이터를 그대로 새 마인드맵으로 저장한다(파싱은 브라우저의
 * DOMParser 가 필요해 서버가 아니라 클라이언트에서 한다 — lib/mindmup-import.ts). */
export async function createMindMapFromOutline(
  title: string,
  data: MindElixirData
): Promise<{ id: string; title: string; seed: unknown } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Authentication required." };

  const finalTitle = title.trim() || "Untitled map";
  const { data: inserted, error } = await supabase
    .from("mind_maps")
    .insert({ owner_id: user.id, title: finalTitle, data: data as unknown as Json })
    .select("id, title, data")
    .single();
  if (error || !inserted) return { error: "Failed to import map." };

  after(async () => {
    const tags = extractTagsFromText(`${finalTitle} ${extractMindmapPlainText(data as unknown as Json)}`);
    await supabase
      .rpc("sync_object_tags", { p_kind: "mindmap", p_id: inserted.id, p_tag_names: tags })
      .then(
        () => {},
        () => {}
      );
  });

  const items = await listWorkspaceItems();

  return {
    id: inserted.id,
    title: inserted.title,
    seed: {
      id: inserted.id,
      title: inserted.title,
      data: inserted.data,
      initialYjsState: null,
      isPublic: false,
      canEdit: true,
      isOwner: true,
      myShareId: user.id,
      items,
    },
  };
}

/** 탭 시스템용: 마인드맵 데이터 + 편집 가능 여부 + 참조 아이템 목록을 조회. */
export async function getMindMapForTab(id: string) {
  const { userId, profile } = await requireUser();
  const supabase = await createClient();

  const { data: map } = await supabase
    .from("mind_maps")
    .select("id, owner_id, title, data, yjs_state, is_public, updated_at")
    .eq("id", id)
    .single();

  if (!map) return null;

  let canEdit = map.owner_id === userId || profile.role === "admin";
  if (!canEdit) {
    const { data: perm } = await supabase
      .from("mind_map_permissions")
      .select("permission")
      .eq("mind_map_id", id)
      .eq("user_id", userId)
      .maybeSingle();
    canEdit = perm?.permission === "edit";
  }

  const items = await listWorkspaceItems();

  return {
    id: map.id,
    title: map.title,
    data: map.data,
    initialYjsState: map.yjs_state,
    isPublic: map.is_public,
    canEdit,
    isOwner: map.owner_id === userId,
    myShareId: userId,
    items,
  };
}

/** 제목/노드 트리 저장. yjsState 는 실시간 동시편집용 Yjs 스냅샷(base64,
 * Y.encodeStateAsUpdate) — 다음 접속자가 이 시점부터 이어서 동기화할 수
 * 있도록 저장해둔다(documents/code_files 의 동일 패턴과 일치). */
export async function saveMindMap(
  id: string,
  title: string,
  data: Json,
  yjsState?: string | null
): Promise<ActionResult> {
  const supabase = await createClient();
  const finalTitle = title.trim() || "Untitled map";
  const { error } = await supabase
    .from("mind_maps")
    .update({
      title: finalTitle,
      data,
      ...(yjsState !== undefined ? { yjs_state: yjsState } : {}),
    })
    .eq("id", id);
  if (error) return { ok: false, error: "Save failed." };

  // 온톨로지 링크 그래프 동기화 — 실패해도 저장 자체는 이미 성공했으므로
  // 무시한다(검색·연결 미리보기가 약간 뒤처질 뿐, 데이터 유실 아님).
  // 저장 응답 속도에 영향이 없도록 응답 전송 이후에 실행한다.
  after(async () => {
    await supabase
      .rpc("sync_object_links", {
        p_source: `mindmap:${id}`,
        p_from_kind: "mindmap",
        p_from_id: id,
        p_links: extractMindmapLinks(data),
      })
      .then(
        () => {},
        () => {}
      );
    const tags = extractTagsFromText(`${finalTitle} ${extractMindmapPlainText(data)}`);
    await supabase
      .rpc("sync_object_tags", { p_kind: "mindmap", p_id: id, p_tag_names: tags })
      .then(
        () => {},
        () => {}
      );
  });

  return { ok: true };
}

export async function deleteMindMap(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("mind_maps").delete().eq("id", id);
  if (error) return { ok: false, error: "Delete failed." };
  after(async () => {
    await supabase.rpc("cleanup_object_links", { p_kind: "mindmap", p_id: id }).then(
      () => {},
      () => {}
    );
    await supabase.rpc("cleanup_object_tags", { p_kind: "mindmap", p_id: id }).then(
      () => {},
      () => {}
    );
  });
  return { ok: true };
}

export async function setMindMapPublic(
  id: string,
  isPublic: boolean
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("mind_maps")
    .update({ is_public: isPublic })
    .eq("id", id);
  if (error) return { ok: false, error: "Update failed." };
  return { ok: true };
}

/** 참조 노드 선택용: 접근 가능한 파일·코드·문서 목록. */
export type WorkspaceItem = {
  id: string;
  label: string;
  kind: "file" | "code" | "document";
};

export async function listWorkspaceItems(): Promise<WorkspaceItem[]> {
  const supabase = await createClient();
  const [files, code, docs] = await Promise.all([
    supabase.from("files").select("id, file_name").order("created_at", { ascending: false }).limit(200),
    supabase.from("code_files").select("id, name").order("updated_at", { ascending: false }).limit(200),
    supabase.from("documents").select("id, title").order("updated_at", { ascending: false }).limit(200),
  ]);
  const out: WorkspaceItem[] = [];
  for (const f of files.data ?? []) out.push({ id: f.id, label: f.file_name, kind: "file" });
  for (const c of code.data ?? []) out.push({ id: c.id, label: c.name, kind: "code" });
  for (const d of docs.data ?? []) out.push({ id: d.id, label: d.title || "Untitled", kind: "document" });
  return out;
}

/** Tiptap JSON 문서에서 순수 텍스트만 추출(미리보기용). */
function extractText(node: unknown, out: string[], limit: number): void {
  if (out.join("").length >= limit) return;
  if (!node || typeof node !== "object") return;
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text" && typeof n.text === "string") out.push(n.text);
  if (Array.isArray(n.content)) {
    for (const child of n.content) {
      if (out.join("").length >= limit) return;
      extractText(child, out, limit);
      if (n.type && n.type !== "text") out.push(" ");
    }
  }
}

export type ReferencePreview =
  | { kind: "document"; title: string; snippet: string }
  | { kind: "code"; title: string; language: string; snippet: string }
  | { kind: "file"; title: string; sizeBytes: number | null; mimeType: string | null };

/** 마인드맵 참조 노드 사이드 미리보기용: 대상 아이템의 요약 정보를 조회한다.
 * 일반 supabase 클라이언트(RLS 적용)를 쓰므로 접근 권한이 없으면 null 이 온다. */
export async function getReferencePreview(
  kind: "file" | "code" | "document",
  id: string
): Promise<ReferencePreview | null> {
  const supabase = await createClient();

  if (kind === "document") {
    const { data } = await supabase
      .from("documents")
      .select("title, content")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    const parts: string[] = [];
    extractText(data.content, parts, 400);
    const snippet = parts.join("").trim().slice(0, 400);
    return { kind: "document", title: data.title || "Untitled", snippet };
  }

  if (kind === "code") {
    const { data } = await supabase
      .from("code_files")
      .select("name, language, content")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    return {
      kind: "code",
      title: data.name,
      language: data.language,
      snippet: (data.content ?? "").slice(0, 400),
    };
  }

  const { data } = await supabase
    .from("files")
    .select("file_name, size_bytes, mime_type")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    kind: "file",
    title: data.file_name,
    sizeBytes: data.size_bytes,
    mimeType: data.mime_type,
  };
}

export async function shareMindMap(
  mapId: string,
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

  const { error } = await supabase.from("mind_map_permissions").upsert(
    { mind_map_id: mapId, user_id: id, permission, granted_by: user.id },
    { onConflict: "mind_map_id,user_id" }
  );
  if (error)
    return {
      ok: false,
      error: "Failed to grant access. Check that the Share ID belongs to an existing user.",
    };
  return { ok: true };
}

export async function revokeMindMapShare(permissionId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("mind_map_permissions")
    .delete()
    .eq("id", permissionId);
  if (error) return { ok: false, error: "Failed to revoke." };
  return { ok: true };
}

export async function listMindMapShares(mapId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("mind_map_permissions")
    .select("id, user_id, permission, granted_at")
    .eq("mind_map_id", mapId)
    .order("granted_at", { ascending: true });
  return data ?? [];
}
