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
    .select("id, owner_id, title, content, visibility, updated_at, yjs_state")
    .eq("id", id)
    .single();

  if (!doc) notFound();

  // 편집 권한 판정: 소유자는 언제나. 'owner' 단계가 아니면 공개거나 관리자거나
  // edit 공유. 'owner' 단계는 소유자 본인 외엔 관리자도 편집할 수 없다
  // (documents_update RLS, 0074 와 같은 판단 기준).
  let canEdit = doc.owner_id === userId;
  if (!canEdit && doc.visibility !== "owner") {
    canEdit = doc.visibility === "public" || profile.role === "admin";
    if (!canEdit) {
      const { data: perm } = await supabase
        .from("document_permissions")
        .select("permission")
        .eq("document_id", id)
        .eq("user_id", userId)
        .maybeSingle();
      canEdit = perm?.permission === "edit";
    }
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
        visibility={doc.visibility}
        myShareId={userId}
        myName={profile.display_name || profile.email}
        myAvatarUrl={profile.avatar_url}
      />
    </>
  );
}
