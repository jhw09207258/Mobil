"use server";

import { createClient } from "@/lib/supabase/server";
import { embedText, toVectorLiteral } from "@/lib/embeddings";
import { measure } from "@/lib/observability";

export type SearchResult = {
  kind: string;
  id: string;
  title: string;
  snippet: string;
  rank: number;
  updated_at: string;
};

export type LinkedObject = {
  kind: string;
  id: string;
  title: string;
  link_source: string;
  depth: number;
  via_title: string | null;
};

export type Backlink = {
  kind: string;
  id: string;
  title: string;
  link_source: string;
};

export type LinkedEvent = {
  id: string;
  title: string;
  starts_at: string;
  all_day: boolean;
  calendar_id: string;
};

export type SemanticResult = {
  kind: string;
  id: string;
  title: string;
  similarity: number;
};

export async function searchOntology(query: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const supabase = await createClient();

  // 검색창에 "#태그" 형태로 입력하면 태그 조회로 라우팅한다.
  if (q.startsWith("#")) {
    const { data, error } = await supabase.rpc("search_by_tag", { p_tag: q });
    if (error || !data) return [];
    return data.map((r) => ({
      kind: r.kind,
      id: r.id,
      title: r.title ?? "",
      snippet: "",
      rank: 0,
      updated_at: r.updated_at ?? "",
    }));
  }

  const { data, error } = await measure(supabase, "search.ontology", async () =>
    supabase.rpc("search_ontology", { p_query: q })
  );
  if (error || !data) return [];
  return data;
}

/** 의미 유사도 검색(RAG 검색 레이어). 임베딩 키 미설정·NVIDIA 장애 시에는
 * 빈 배열 — 검색창은 어휘 검색만으로 동작한다(우아한 강등). */
export async function searchSemantic(query: string): Promise<SemanticResult[]> {
  const q = query.trim();
  if (!q || q.startsWith("#")) return [];
  const embedding = await embedText(q, "query");
  if (!embedding) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("match_objects", {
    p_embedding: toVectorLiteral(embedding),
    p_limit: 6,
  });
  if (error || !data) return [];
  // 관련 없는 항목까지 끌려오지 않도록 유사도 하한을 둔다.
  return data
    .filter((r) => r.similarity >= 0.35)
    .map((r) => ({ kind: r.kind, id: r.id, title: r.title ?? "Untitled", similarity: r.similarity }));
}

/** 연결 항목 — 온톨로지 그래프를 2단계까지 탐색(간접 연결은 경유 항목 표시). */
export async function getLinkedObjects(kind: string, id: string): Promise<LinkedObject[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_linked_objects_deep", {
    p_kind: kind,
    p_id: id,
    p_depth: 2,
  });
  if (error || !data) return [];
  return data.map((r) => ({ ...r, title: r.title ?? "Untitled" }));
}

/** 백링크 — 이 항목을 가리키는(내가 아니라 남이 건) 링크만, 1단계
 * (Obsidian 의 Backlinks 패널과 같은 개념. get_linked_objects 와 달리
 * 방향을 하나로 좁힌다 — 본문을 읽어서는 알 수 없는 쪽이라 이 방향이 궁금하다). */
export async function getBacklinks(kind: string, id: string): Promise<Backlink[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_backlinks", { p_kind: kind, p_id: id });
  if (error || !data) return [];
  return data.map((r) => ({ ...r, title: r.title ?? "Untitled" }));
}

/** 이 항목을 참조하는 캘린더 일정(get_object_events, 0078) — calendar_event_links
 * 는 지금까지 일정 → 자료 방향으로만 조회됐다. 문서 에디터에 "관련 일정"을
 * 보여주려면 반대 방향이 필요하다. */
export async function getObjectEvents(kind: string, id: string): Promise<LinkedEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_object_events", { p_kind: kind, p_id: id });
  if (error || !data) return [];
  return data;
}
