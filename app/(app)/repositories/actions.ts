"use server";

import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser as requireUser } from "@/lib/auth";

export type Repository = { id: string; name: string; parentId: string | null };
export type RepoItemKind = "document" | "code" | "sheet" | "mindmap" | "file";
export type RepoEntryKind = "folder" | RepoItemKind;
export type RepositoryEntry = { kind: RepoEntryKind; id: string; label: string };

const KIND_TABLE = {
  document: "documents",
  code: "code_files",
  sheet: "sheets",
  mindmap: "mind_maps",
  file: "files",
} as const;

const NAME_LIMIT_ERROR = "Name must be 1-80 characters.";

/** 이 사용자가 볼 수 있는 저장소/폴더 전부(평평하게, 부모 정보 포함).
 * 랜딩 화면은 parentId 가 없는 것만 걸러 최상위만 보여주고, 드릴다운은
 * 서버 왕복 없이 이 목록을 그대로 훑어 자식을 찾는다 — 저장소 개수가
 * 수천 단위가 아닌 이상(개인/팀 워크스페이스라 현실적으로 아니다) 굳이
 * 레벨마다 다시 조회할 이유가 없다. */
export async function listRepositories(): Promise<Repository[]> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("repositories")
    .select("id, name, parent_id")
    .order("created_at", { ascending: true });
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id }));
}

/** 최상위 저장소 또는 그 안의 폴더 — parentId 를 주면 폴더가 된다.
 * 순환/깊이 상한(8단)/소유자 일치는 DB 트리거(prevent_repository_cycle,
 * 0078)가 강제한다 — 여기서 또 검사하지 않는다(같은 검사를 두 곳에 두면
 * 둘 중 하나가 어긋나기 쉽다, 진실은 한 곳에). */
export async function createRepository(
  name: string,
  parentId: string | null = null
): Promise<Repository | { error: string }> {
  const { userId } = await requireUser();
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) return { error: NAME_LIMIT_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("repositories")
    .insert({ owner_id: userId, name: trimmed, parent_id: parentId })
    .select("id, name, parent_id")
    .single();
  if (error || !data) {
    return {
      error:
        error?.message.includes("nest") || error?.message.includes("cycle") || error?.message.includes("levels")
          ? error.message
          : "Failed to create repository.",
    };
  }
  return { id: data.id, name: data.name, parentId: data.parent_id };
}

export async function renameRepository(
  id: string,
  name: string
): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) return { error: NAME_LIMIT_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.from("repositories").update({ name: trimmed }).eq("id", id);
  if (error) return { error: "Failed to rename repository." };
  return { ok: true };
}

/** 폴더/저장소를 다른 폴더 밑으로 옮긴다(null = 최상위로). */
export async function moveRepository(
  id: string,
  parentId: string | null
): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("repositories").update({ parent_id: parentId }).eq("id", id);
  if (error) {
    return {
      error:
        error.message.includes("nest") || error.message.includes("cycle") || error.message.includes("levels")
          ? error.message
          : "Failed to move.",
    };
  }
  return { ok: true };
}

export async function deleteRepository(id: string): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  // 아이템은 FK on delete set null 로 Null Repository 로, 하위 폴더는 최상위로
  // 돌아간다(유실 없음, 0078).
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

/** 아이템을 저장소/폴더로 이동(null = Null Repository). 편집 권한은 각 테이블의
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

/** 특정 저장소/폴더(null = Null Repository)의 바로 아래 자식만 — 하위 폴더 +
 * 문서/코드/시트/맵/파일 전부 하나의 목록으로 합쳐서(Docs/Code/Table/파일을
 * 따로 나눠 보여주던 것을 통합). list_repository_contents(0078)가 UNION ALL
 * 로 한 번에 묶어 왕복을 하나로 줄인다(list_attachable_objects, 0065 와
 * 같은 방식). Null Repository(=null)에는 폴더가 없다 — 최상위 저장소 자체가
 * 이미 랜딩 목록에 있다. */
export async function listRepositoryContents(
  repositoryId: string | null
): Promise<RepositoryEntry[]> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_repository_contents", {
    p_repository: repositoryId,
  });
  return (data ?? []) as RepositoryEntry[];
}

export type RepositoryGraphNode = {
  kind: RepoEntryKind | "event";
  id: string;
  label: string;
  containerId: string | null;
};
export type RepositoryGraphEdge = {
  aKind: RepoEntryKind | "event";
  aId: string;
  bKind: RepoEntryKind | "event";
  bId: string;
};
export type RepositoryGraph = { nodes: RepositoryGraphNode[]; edges: RepositoryGraphEdge[] };

/** 저장소 하나를 그래프로 — 폴더 포함관계 + object_links 참조 + 캘린더 일정
 * 연결을 한 번에(get_repository_graph, 0078). 저장소는 공유 개념이 없으므로
 * (0044) 소유자 본인/관리자가 아니면 빈 그래프가 온다. */
export async function getRepositoryGraph(repositoryId: string): Promise<RepositoryGraph> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_repository_graph", { p_repository: repositoryId });
  if (error || !data || typeof data !== "object") return { nodes: [], edges: [] };
  const g = data as { nodes?: unknown; edges?: unknown };
  return {
    nodes: Array.isArray(g.nodes) ? (g.nodes as RepositoryGraphNode[]) : [],
    edges: Array.isArray(g.edges) ? (g.edges as RepositoryGraphEdge[]) : [],
  };
}
