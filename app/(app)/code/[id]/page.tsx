import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { CodeEditor } from "./code-editor";

export const dynamic = "force-dynamic";

export default async function CodeFilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId, profile } = await requireUser();
  const supabase = await createClient();

  const { data: file } = await supabase
    .from("code_files")
    .select("id, owner_id, name, language, content, is_public, updated_at, yjs_state")
    .eq("id", id)
    .single();

  if (!file) notFound();

  let canEdit = file.owner_id === userId || profile.role === "admin" || file.is_public;
  if (!canEdit) {
    const { data: perm } = await supabase
      .from("code_file_permissions")
      .select("permission")
      .eq("code_file_id", id)
      .eq("user_id", userId)
      .maybeSingle();
    canEdit = perm?.permission === "edit";
  }

  const isOwner = file.owner_id === userId;

  return (
    <>
      <div className="topbar">
        <div className="row" style={{ gap: 12 }}>
          <Link href="/code" className="btn btn-ghost btn-sm">
            ← Code
          </Link>
          <span className="crumb">
            WORKSPACE / CODE / {file.id.slice(0, 8)}
          </span>
        </div>
        <span className="crumb">{canEdit ? "READ · WRITE" : "READ ONLY"}</span>
      </div>
      <CodeEditor
        fileId={file.id}
        initialName={file.name}
        initialLanguage={file.language}
        initialContent={file.content}
        initialYjsState={file.yjs_state}
        canEdit={canEdit}
        isOwner={isOwner}
        isPublic={file.is_public}
        myShareId={userId}
        myName={profile.display_name || profile.email}
        myAvatarUrl={profile.avatar_url}
      />
    </>
  );
}
