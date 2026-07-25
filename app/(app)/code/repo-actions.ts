"use server";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { detectLanguage } from "@/lib/languages";

export type CodeRepository = {
  id: string;
  name: string;
  github_owner: string | null;
  github_repo: string | null;
  github_ref: string | null;
  imported_at: string | null;
  created_at: string;
  file_count: number;
};

export type CodeRepoFile = {
  id: string;
  name: string;
  path: string | null;
  language: string;
  updated_at: string;
};

export async function listCodeRepositories(): Promise<CodeRepository[]> {
  await requireUser();
  const supabase = await createClient();
  const { data: repos } = await supabase
    .from("code_repositories")
    .select("id, name, github_owner, github_repo, github_ref, imported_at, created_at")
    .order("created_at", { ascending: false });
  if (!repos?.length) return [];

  // 저장소별 파일 수 — RLS 가 이미 볼 수 있는 것만 돌려주므로 단순 집계로 충분.
  const { data: files } = await supabase
    .from("code_files")
    .select("code_repository_id")
    .not("code_repository_id", "is", null);
  const counts = new Map<string, number>();
  for (const f of files ?? []) {
    const key = f.code_repository_id as string;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return repos.map((r) => ({ ...r, file_count: counts.get(r.id) ?? 0 }));
}

export async function listCodeRepoFiles(repoId: string): Promise<CodeRepoFile[]> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("code_files")
    .select("id, name, path, language, updated_at")
    .eq("code_repository_id", repoId)
    .order("path", { ascending: true });
  return data ?? [];
}

export async function createCodeRepository(
  name: string,
  github?: { owner: string; repo: string; ref: string }
): Promise<{ id: string } | { error: string }> {
  const { userId } = await requireUser();
  const trimmed = name.trim();
  if (!trimmed) return { error: "Give the repository a name." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("code_repositories")
    .insert({
      owner_id: userId,
      name: trimmed.slice(0, 120),
      github_owner: github?.owner ?? null,
      github_repo: github?.repo ?? null,
      github_ref: github?.ref ?? null,
      imported_at: github ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error || !data) return { error: "Could not create the repository." };
  return { id: data.id };
}

export async function renameCodeRepository(
  id: string,
  name: string
): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const trimmed = name.trim();
  if (!trimmed) return { error: "Name can't be empty." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("code_repositories")
    .update({ name: trimmed.slice(0, 120) })
    .eq("id", id);
  if (error) return { error: "Rename failed." };
  return { ok: true };
}

/** 저장소를 휴지통으로 — 안에 든 코드 파일도 함께 넣는다(복원도 함께). */
export async function deleteCodeRepository(
  id: string
): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  const { data: files } = await supabase
    .from("code_files")
    .select("id")
    .eq("code_repository_id", id);
  for (const f of files ?? []) {
    await supabase.rpc("move_to_trash", { p_kind: "code", p_id: f.id });
  }
  const { error } = await supabase
    .from("code_repositories")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: "Delete failed." };
  return { ok: true };
}

/** 임포트/업로드로 들어온 파일 한 개를 저장한다. 경로에서 언어를 추론한다. */
export async function addCodeFileToRepo(
  repoId: string,
  path: string,
  content: string
): Promise<{ id: string } | { error: string }> {
  const { userId } = await requireUser();
  const supabase = await createClient();
  const name = path.split("/").pop() || "untitled";
  const { data, error } = await supabase
    .from("code_files")
    .insert({
      owner_id: userId,
      name,
      path,
      language: detectLanguage(name),
      content,
      code_repository_id: repoId,
    })
    .select("id")
    .single();
  if (error || !data) return { error: `Failed to save ${path}` };
  return { id: data.id };
}
