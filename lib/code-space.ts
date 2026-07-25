import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * 코드 파일은 Code Space 없이는 존재할 수 없다(0055). 코드를 만들어내는 흐름
 * (GitHub 파일 임포트, Big Brother 도구 등)은 넣을 Space 가 필요하므로,
 * 이름으로 찾아보고 없으면 만들어 준다.
 *
 * 이름을 안 주면 "Big Brother" 로 모은다 — 에이전트가 만든 파일이 여기저기
 * 흩어지는 것보다 한곳에 쌓이는 편이 찾기 쉽다.
 */
export async function ensureCodeSpace(
  supabase: SupabaseClient<Database>,
  userId: string,
  name = "Big Brother"
): Promise<string | null> {
  const trimmed = name.trim().slice(0, 120) || "Big Brother";

  const { data: existing } = await supabase
    .from("code_repositories")
    .select("id")
    .eq("owner_id", userId)
    .eq("name", trimmed)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: made } = await supabase
    .from("code_repositories")
    .insert({ owner_id: userId, name: trimmed })
    .select("id")
    .single();
  return made?.id ?? null;
}

/**
 * 같은 Code Space 안에서 경로가 겹치지 않게 만든다. 겹치면 이름 뒤에 -2, -3…
 * 을 붙인다(확장자는 유지). 경로가 유일해야 에이전트의 commit_files 가 파일을
 * 정확히 찾아 덮어쓸 수 있다.
 */
export async function uniquePath(
  supabase: SupabaseClient<Database>,
  spaceId: string,
  wanted: string
): Promise<string> {
  const clean = wanted.trim().replace(/^\/+/, "") || "untitled.txt";
  const { data } = await supabase
    .from("code_files")
    .select("path")
    .eq("code_repository_id", spaceId);
  const taken = new Set((data ?? []).map((r) => r.path));
  if (!taken.has(clean)) return clean;

  const dot = clean.lastIndexOf(".");
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : "";
  for (let i = 2; i < 500; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}
