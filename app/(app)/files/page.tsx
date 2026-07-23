import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { FilesClient } from "./files-client";
import { listStarredIds } from "../starred-actions";
import { listRepositories } from "../repositories/actions";

export const dynamic = "force-dynamic";

export default async function FilesPage() {
  const { userId, profile } = await requireUser();
  const supabase = await createClient();

  const [{ data: files }, { data: editPerms }, starredIds, repositories] = await Promise.all([
    supabase
      .from("files")
      .select(
        "id, owner_id, storage_path, file_name, mime_type, size_bytes, is_public, created_at, repository_id"
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("file_permissions")
      .select("file_id")
      .eq("user_id", userId)
      .eq("permission", "edit"),
    listStarredIds("file"),
    listRepositories(),
  ]);

  const isAdmin = profile.role === "admin";
  const editableIds = new Set((editPerms ?? []).map((p) => p.file_id));
  const filesWithEdit = (files ?? []).map((f) => ({
    ...f,
    canEdit: f.owner_id === userId || isAdmin || f.is_public || editableIds.has(f.id),
  }));

  return (
    <>
      <div className="content">
        <FilesClient
          initialFiles={filesWithEdit}
          userId={userId}
          starredIds={starredIds}
          repositories={repositories}
        />
      </div>
    </>
  );
}
