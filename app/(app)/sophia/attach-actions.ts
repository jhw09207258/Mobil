"use server";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";

// 어시스턴트 첨부용 업로드/조회.
//
// 새로 올린 파일은 기존 files 버킷의 사용자별 경로에 넣는다 — 저장소·RLS·정리
// 정책을 그대로 물려받기 위해서다. 워크스페이스 파일은 이미 거기 있으므로
// 경로만 골라 쓴다.

const BUCKET = "files";

export type WorkspaceFileRow = {
  id: string;
  name: string;
  path: string;
  mime: string | null;
  bytes: number | null;
};

/** 이미 올려둔 파일 목록 — 첨부 피커용. */
export async function listWorkspaceFiles(query: string): Promise<WorkspaceFileRow[]> {
  const { userId } = await requireUser();
  const supabase = await createClient();
  const q = query.trim();
  let req = supabase
    .from("files")
    .select("id, file_name, storage_path, mime_type, size_bytes")
    .eq("owner_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(40);
  if (q) req = req.ilike("file_name", `%${q}%`);
  const { data } = await req;
  return (data ?? []).map((f) => ({
    id: f.id,
    name: f.file_name,
    path: f.storage_path,
    mime: f.mime_type,
    bytes: f.size_bytes,
  }));
}

/**
 * 첨부용 업로드. 서명 URL 을 돌려주지 않고 서버가 직접 올린다 — 첨부는 보통
 * 작고, 한 번에 끝나는 편이 클라이언트가 단순하다.
 */
export async function uploadAttachment(
  form: FormData
): Promise<{ path: string; name: string; mime: string } | { error: string }> {
  const { userId } = await requireUser();
  const file = form.get("file");
  if (!(file instanceof File)) return { error: "No file given." };
  if (file.size > 8 * 1024 * 1024) {
    return { error: "That file is larger than 8 MB." };
  }

  const supabase = await createClient();
  // 이름 충돌과 경로 탈출을 함께 막는다 — 파일명은 사용자 입력이다.
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80) || "attachment";
  const path = `${userId}/bb/${Date.now()}-${safe}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) return { error: "Upload failed." };

  return { path, name: file.name, mime: file.type || "application/octet-stream" };
}
