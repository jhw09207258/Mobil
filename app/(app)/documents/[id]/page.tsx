import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { DocumentEditorLoader } from "./editor-loader";
import { listContributors } from "../../contributors/actions";
import { listRepositories, getItemRepository } from "../../repositories/actions";

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
  }
  const needsPermCheck = !canEdit && doc.visibility !== "owner";

  // 에디터 상단바가 자기 마운트 시점에 따로 불러오던 기여자 목록/저장소
  // 배정을 여기서 같이 가져온다 — /documents/[id] 로 직접 들어온 경우(탭
  // 시스템을 거치지 않는 경로)도 getDocumentForTab 과 같은 이득을 보게
  // 맞춘다.
  const [perm, contributors, repos, itemRepo] = await Promise.all([
    needsPermCheck
      ? supabase
          .from("document_permissions")
          .select("permission")
          .eq("document_id", id)
          .eq("user_id", userId)
          .maybeSingle()
      : Promise.resolve({ data: null as { permission: string } | null }),
    listContributors("document", id),
    listRepositories(),
    getItemRepository("document", id),
  ]);
  if (needsPermCheck) canEdit = perm.data?.permission === "edit";

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
        initialContributors={contributors}
        initialRepos={repos}
        initialRepositoryId={itemRepo?.repositoryId ?? null}
      />
    </>
  );
}
