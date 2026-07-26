"use server";

import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser as requireUser } from "@/lib/auth";
// 타입·상수는 별도 모듈에 둔다 — "use server" 파일은 export 가 전부 async
// 함수여야 하고, 상수를 하나라도 내보내면 모듈이 통째로 깨진다.
import type { Plugin, PluginCandidate, PluginKind } from "./plugin-types";

// ============================================================================
// Plugin — 대화에 연결한 작업 대상.
//
// 어시스턴트는 지금까지 매번 검색으로 대상을 추측했다. 여기 붙여 두면 id 를
// 바로 알고 작업하므로, 엉뚱한 문서를 덮어쓰는 사고와 매 턴의 검색 토큰이
// 함께 사라진다.
// ============================================================================

export async function listPlugins(conversationId: string): Promise<Plugin[]> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_conversation_plugins", {
    p_conversation_id: conversationId,
  });
  return (data ?? []).map((r) => ({
    kind: r.kind as PluginKind,
    objectId: r.object_id,
    title: r.title,
    subtitle: r.subtitle,
  }));
}

export async function attachPlugin(
  conversationId: string,
  kind: PluginKind,
  objectId: string
): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  // RLS 가 남의 대화를 막고, 대상 자체는 도구가 쓸 때 다시 권한을 확인한다.
  const { error } = await supabase
    .from("ai_conversation_plugins")
    .insert({ conversation_id: conversationId, kind, object_id: objectId });
  if (error) {
    // unique 위반 = 이미 붙어 있음. 사용자에게는 실패가 아니다.
    if (error.code === "23505") return { ok: true };
    return { error: "Could not attach that item." };
  }
  return { ok: true };
}

export async function detachPlugin(
  conversationId: string,
  kind: PluginKind,
  objectId: string
): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("ai_conversation_plugins")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("kind", kind)
    .eq("object_id", objectId);
  if (error) return { error: "Could not detach that item." };
  return { ok: true };
}

/** 붙일 수 있는 항목 목록 — 피커용. 내가 소유한 것만. */
export async function listPluginCandidates(query: string): Promise<PluginCandidate[]> {
  const { userId } = await requireUser();
  const supabase = await createClient();
  const q = query.trim().toLowerCase();

  const [docs, sheets, maps, spaces, repos] = await Promise.all([
    supabase.from("documents").select("id, title").is("deleted_at", null).eq("owner_id", userId).limit(50),
    supabase.from("sheets").select("id, title").is("deleted_at", null).eq("owner_id", userId).limit(50),
    supabase.from("mind_maps").select("id, title").is("deleted_at", null).eq("owner_id", userId).limit(50),
    supabase
      .from("code_repositories")
      .select("id, name, github_owner, github_repo")
      .is("deleted_at", null)
      .eq("owner_id", userId)
      .limit(50),
    supabase.from("repositories").select("id, name").eq("owner_id", userId).limit(50),
  ]);

  const all: PluginCandidate[] = [
    ...(docs.data ?? []).map((d) => ({
      kind: "document" as const,
      id: d.id,
      title: d.title || "Untitled",
      subtitle: null,
    })),
    ...(sheets.data ?? []).map((s) => ({
      kind: "sheet" as const,
      id: s.id,
      title: s.title || "Untitled",
      subtitle: null,
    })),
    ...(maps.data ?? []).map((m) => ({
      kind: "mindmap" as const,
      id: m.id,
      title: m.title || "Untitled",
      subtitle: null,
    })),
    ...(spaces.data ?? []).map((c) => ({
      kind: "code_space" as const,
      id: c.id,
      title: c.name,
      subtitle: c.github_owner ? `${c.github_owner}/${c.github_repo}` : null,
    })),
    ...(repos.data ?? []).map((r) => ({
      kind: "repository" as const,
      id: r.id,
      title: r.name,
      subtitle: null,
    })),
  ];

  if (!q) return all.slice(0, 40);
  return all.filter((c) => c.title.toLowerCase().includes(q)).slice(0, 40);
}
