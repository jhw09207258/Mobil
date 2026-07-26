import type { Viewport } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { listWorkspaceItems } from "../actions";
import { MindMapCanvasLoader } from "./canvas-loader";

export const dynamic = "force-dynamic";

// 앱 전체는 확대를 잠그지만(레이아웃이 확대되면 SaaS UI 가 깨진다) 마인드맵은
// 예외다 — 넓은 맵을 손가락으로 살펴보는 것이 이 화면의 기본 동작이다.
// 이 라우트에서만 핀치 줌을 되살린다(툴바의 자체 확대는 그대로 쓴다).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default async function MindMapEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId, profile } = await requireUser();
  const supabase = await createClient();

  const { data: map } = await supabase
    .from("mind_maps")
    .select("id, owner_id, title, data, yjs_state, is_public, updated_at")
    .eq("id", id)
    .single();

  if (!map) notFound();

  let canEdit = map.owner_id === userId || profile.role === "admin" || map.is_public;
  if (!canEdit) {
    const { data: perm } = await supabase
      .from("mind_map_permissions")
      .select("permission")
      .eq("mind_map_id", id)
      .eq("user_id", userId)
      .maybeSingle();
    canEdit = perm?.permission === "edit";
  }

  const items = await listWorkspaceItems(id);

  return (
    <>
      <MindMapCanvasLoader
        mapId={map.id}
        initialTitle={map.title}
        initialData={map.data}
        initialYjsState={map.yjs_state}
        canEdit={canEdit}
        isOwner={map.owner_id === userId}
        isPublic={map.is_public}
        myShareId={userId}
        myName={profile.display_name || profile.email}
        myAvatarUrl={profile.avatar_url}
        items={items}
      />
    </>
  );
}
