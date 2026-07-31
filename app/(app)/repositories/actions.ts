"use server";

import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser as requireUser } from "@/lib/auth";

export type Repository = { id: string; name: string };
export type RepoItemKind = "document" | "code" | "sheet" | "mindmap" | "file";

const KIND_TABLE = {
  document: "documents",
  code: "code_files",
  sheet: "sheets",
  mindmap: "mind_maps",
  file: "files",
} as const;

export async function listRepositories(): Promise<Repository[]> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("repositories")
    .select("id, name")
    .order("created_at", { ascending: true });
  return data ?? [];
}

export async function createRepository(
  name: string
): Promise<Repository | { error: string }> {
  const { userId } = await requireUser();
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) return { error: "Repository name must be 1-80 characters." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("repositories")
    .insert({ owner_id: userId, name: trimmed })
    .select("id, name")
    .single();
  if (error || !data) return { error: "Failed to create repository." };
  return data;
}

export async function renameRepository(
  id: string,
  name: string
): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) return { error: "Repository name must be 1-80 characters." };
  const supabase = await createClient();
  const { error } = await supabase.from("repositories").update({ name: trimmed }).eq("id", id);
  if (error) return { error: "Failed to rename repository." };
  return { ok: true };
}

export async function deleteRepository(id: string): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  // 아이템은 FK on delete set null 로 Null Repository 로 돌아간다(유실 없음).
  const { error } = await supabase.from("repositories").delete().eq("id", id);
  if (error) return { error: "Failed to delete repository." };
  return { ok: true };
}

/** 아이템의 현재 저장소. RLS 로 열람 가능한 아이템만 조회된다. */
export async function getItemRepository(
  kind: RepoItemKind,
  id: string
): Promise<{ repositoryId: string | null } | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from(KIND_TABLE[kind])
    .select("repository_id")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return { repositoryId: data.repository_id };
}

/** 아이템을 저장소로 이동(null = Null Repository). 편집 권한은 각 테이블의
 * 기존 UPDATE RLS 가 강제한다. */
export async function setItemRepository(
  kind: RepoItemKind,
  id: string,
  repositoryId: string | null
): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from(KIND_TABLE[kind])
    .update({ repository_id: repositoryId })
    .eq("id", id);
  if (error) return { error: "Failed to move the item." };
  return { ok: true };
}

export type RepositoryContents = {
  documents: { id: string; title: string }[];
  code: { id: string; name: string }[];
  sheets: { id: string; title: string }[];
  mindmaps: { id: string; title: string }[];
};

/** 특정 저장소(null = Null Repository)에 속한 내 콘텐츠 — 파일 제외
 * (파일은 /files 표 자체가 필터링해 보여준다).
 *
 * 예전에는 documents/code_files/sheets/mind_maps 네 테이블을 Promise.all 로
 * 병렬 조회했다 — 지연은 겹쳐서 없앴지만 왕복 자체는 여전히 네 번이었다.
 * list_repository_contents(0075)가 UNION ALL 로 한 번에 묶어 왕복을 하나로
 * 줄인다(list_attachable_objects, 0065 와 같은 방식). */
export async function listRepositoryContents(
  repositoryId: string | null
): Promise<RepositoryContents> {
  await requireUser();
  const supabase = await createClient();

  const { data } = await supabase.rpc("list_repository_contents", {
    p_repository: repositoryId,
  });
  const rows = data ?? [];

  return {
    documents: rows.filter((r) => r.kind === "document").map((r) => ({ id: r.id, title: r.label })),
    code: rows.filter((r) => r.kind === "code").map((r) => ({ id: r.id, name: r.label })),
    sheets: rows.filter((r) => r.kind === "sheet").map((r) => ({ id: r.id, title: r.label })),
    mindmaps: rows.filter((r) => r.kind === "mindmap").map((r) => ({ id: r.id, title: r.label })),
  };
}
