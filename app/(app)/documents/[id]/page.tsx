import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { DocumentEditorLoader } from "./editor-loader";

export const dynamic = "force-dynamic";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId, profile } = await requireUser();
  const supabase = await createClient();

  const { data: doc } = await supabase
    .from("documents")
    .select("id, owner_id, title, content, is_public, updated_at, yjs_state")
    .eq("id", id)
    .single();

  if (!doc) notFound();

  // 편집 권한 판정: 소유자 / 공개 문서 / edit 권한 / 관리자
  let canEdit = doc.owner_id === userId || profile.role === "admin" || doc.is_public;
  if (!canEdit) {
    const { data: perm } = await supabase
      .from("document_permissions")
      .select("permission")
      .eq("document_id", id)
      .eq("user_id", userId)
      .maybeSingle();
    canEdit = perm?.permission === "edit";
  }

  const isOwner = doc.owner_id === userId;

  return (
    <>
      <DocumentEditorLoader
        docId={doc.id}
        initialTitle={doc.title}
        initialContent={doc.content}
        initialYjsState={doc.yjs_state}
        canEdit={canEdit}
        isOwner={isOwner}
        isPublic={doc.is_public}
        myShareId={userId}
        myName={profile.display_name || profile.email}
        myAvatarUrl={profile.avatar_url}
      />
    </>
  );
}
