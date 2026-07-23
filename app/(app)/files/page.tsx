import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { FilesClient } from "./files-client";
import { listStarredIds } from "../starred-actions";

export const dynamic = "force-dynamic";

export default async function FilesPage() {
  const { userId, profile } = await requireUser();
  const supabase = await createClient();

  const [{ data: files }, { data: editPerms }, starredIds] = await Promise.all([
    supabase
      .from("files")
      .select(
        "id, owner_id, storage_path, file_name, mime_type, size_bytes, is_public, created_at"
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("file_permissions")
      .select("file_id")
      .eq("user_id", userId)
      .eq("permission", "edit"),
    listStarredIds("file"),
  ]);

  const isAdmin = profile.role === "admin";
  const editableIds = new Set((editPerms ?? []).map((p) => p.file_id));
  const filesWithEdit = (files ?? []).map((f) => ({
    ...f,
    canEdit: f.owner_id === userId || isAdmin || f.is_public || editableIds.has(f.id),
  }));

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">Repository</span>
        <span className="crumb">WORKSPACE / REPOSITORY</span>
      </div>
      <div className="content">
        <FilesClient
          initialFiles={filesWithEdit}
          userId={userId}
          starredIds={starredIds}
        />
      </div>
    </>
  );
}
