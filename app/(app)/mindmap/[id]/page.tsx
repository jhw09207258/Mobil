import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { listWorkspaceItems } from "../actions";
import { MindMapCanvasLoader } from "./canvas-loader";

export const dynamic = "force-dynamic";

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

  const items = await listWorkspaceItems();

  return (
    <>
      <div className="topbar">
        <div className="row" style={{ gap: 12 }}>
          <Link href="/mindmap" className="btn btn-ghost btn-sm">
            ← Link Graph
          </Link>
          <span className="crumb">WORKSPACE / LINK GRAPH / {map.id.slice(0, 8)}</span>
        </div>
        <span className="crumb">{canEdit ? "READ · WRITE" : "READ ONLY"}</span>
      </div>
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
