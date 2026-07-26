"use server";

import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser as requireUser } from "@/lib/auth";
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
  // Space 와 그 안의 파일을 한 번에 휴지통으로. 휴지통에서 Space 를 복원하면
  // 파일도 함께 돌아온다(0056).
  const { error } = await supabase.rpc("move_to_trash", {
    p_kind: "code_space",
    p_id: id,
  });
  if (error) return { error: "Delete failed." };
  return { ok: true };
}

/** Code Space 워크스페이스에서 파일 하나를 연다. */
export async function getCodeSpace(
  id: string
): Promise<{ id: string; name: string; github_owner: string | null; github_repo: string | null } | null> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("code_repositories")
    .select("id, name, github_owner, github_repo")
    .eq("id", id)
    .single();
  return data ?? null;
}

export async function readSpaceFile(fileId: string): Promise<
  | { content: string; language: string; name: string; yjsState: string | null }
  | { error: string }
> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("code_files")
    .select("content, language, name, yjs_state")
    .eq("id", fileId)
    .single();
  if (!data) return { error: "File not found." };
  return {
    content: data.content ?? "",
    language: data.language,
    name: data.name,
    yjsState: data.yjs_state,
  };
}

/**
 * 워크스페이스 에디터의 저장.
 *
 * yjs_state 를 반드시 함께 쓴다. 예전에는 여기서 null 로 지웠는데, 그러면 같은
 * 파일을 탭 편집기(/code/[id])에서 열어 둔 사람의 협업 스냅샷이 매 저장마다
 * 날아갔다. 이제 워크스페이스도 정식 Yjs 피어라서 자기 스냅샷을 남긴다.
 */
export async function writeSpaceFile(
  fileId: string,
  content: string,
  yjsState?: string | null
): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  const { data: saved, error } = await supabase
    .from("code_files")
    .update({ content, ...(yjsState !== undefined ? { yjs_state: yjsState } : {}) })
    .eq("id", fileId)
    .select("id")
    .maybeSingle();
  // RLS 가 조용히 0행을 매칭시킬 수 있다 — select 로 실제로 쓴 행이 있는지
  // 확인한다. 안 그러면 "저장됨"을 보여주면서 아무것도 저장되지 않는다.
  if (error || !saved) return { error: "Save failed — you may no longer have access." };
  return { ok: true };
}

/** 경로 변경 = VS Code 의 rename/move. 폴더는 경로에 내포돼 있으므로 둘이 같은 동작이다. */
export async function renameSpaceFile(
  fileId: string,
  nextPath: string
): Promise<{ ok: true; path: string; name: string } | { error: string }> {
  await requireUser();
  const clean = nextPath.trim().replace(/^\/+/, "");
  if (!clean) return { error: "Give the file a path." };
  const supabase = await createClient();

  const { data: file } = await supabase
    .from("code_files")
    .select("code_repository_id")
    .eq("id", fileId)
    .single();
  if (!file) return { error: "File not found." };

  const { data: clash } = await supabase
    .from("code_files")
    .select("id")
    .eq("code_repository_id", file.code_repository_id)
    .eq("path", clean)
    .neq("id", fileId)
    .maybeSingle();
  if (clash) return { error: `${clean} already exists.` };

  const name = clean.split("/").pop() || "untitled";
  const { error } = await supabase
    .from("code_files")
    .update({ path: clean, name, language: detectLanguage(name) })
    .eq("id", fileId);
  if (error) return { error: "Rename failed." };
  return { ok: true, path: clean, name };
}

/** 파일을 휴지통으로(18시간 뒤 자동 삭제) — 다른 삭제와 같은 규칙. */
export async function deleteSpaceFile(
  fileId: string
): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("move_to_trash", { p_kind: "code", p_id: fileId });
  if (error) return { error: "Delete failed." };
  return { ok: true };
}

/** 폴더 이름 변경 = 그 아래 모든 파일의 경로 접두사 교체. */
export async function renameSpaceFolder(
  spaceId: string,
  fromPrefix: string,
  toPrefix: string
): Promise<{ ok: true; moved: number } | { error: string }> {
  await requireUser();
  const from = fromPrefix.replace(/^\/+|\/+$/g, "");
  const to = toPrefix.trim().replace(/^\/+|\/+$/g, "");
  if (!from || !to) return { error: "Give the folder a name." };
  if (from === to) return { ok: true, moved: 0 };

  const supabase = await createClient();
  const { data: files } = await supabase
    .from("code_files")
    .select("id, path")
    .eq("code_repository_id", spaceId)
    .like("path", `${from}/%`);
  if (!files?.length) return { ok: true, moved: 0 };

  const existing = new Set(
    (
      await supabase.from("code_files").select("path").eq("code_repository_id", spaceId)
    ).data?.map((r) => r.path) ?? []
  );
  // 옮긴 자리에 이미 파일이 있으면 조용히 덮어쓰지 않고 멈춘다.
  for (const f of files) {
    const next = `${to}/${f.path.slice(from.length + 1)}`;
    if (existing.has(next)) return { error: `${next} already exists.` };
  }

  let moved = 0;
  for (const f of files) {
    const next = `${to}/${f.path.slice(from.length + 1)}`;
    const name = next.split("/").pop() || "untitled";
    const { error } = await supabase
      .from("code_files")
      .update({ path: next, name })
      .eq("id", f.id);
    if (!error) moved++;
  }
  return { ok: true, moved };
}

/** 빈 파일을 만든다 — 새 Code Space 를 바닥부터 만들 때 쓴다. */
export async function createSpaceFile(
  spaceId: string,
  path: string
): Promise<{ id: string } | { error: string }> {
  const { userId } = await requireUser();
  const clean = path.trim().replace(/^\/+/, "");
  if (!clean) return { error: "Give the file a path." };
  const supabase = await createClient();
  const { data: dupe } = await supabase
    .from("code_files")
    .select("id")
    .eq("code_repository_id", spaceId)
    .eq("path", clean)
    .maybeSingle();
  if (dupe) return { error: `${clean} already exists.` };
  const name = clean.split("/").pop() || "untitled";
  const { data, error } = await supabase
    .from("code_files")
    .insert({
      owner_id: userId,
      name,
      path: clean,
      language: detectLanguage(name),
      content: "",
      code_repository_id: spaceId,
    })
    .select("id")
    .single();
  if (error || !data) return { error: "Could not create the file." };
  return { id: data.id };
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
