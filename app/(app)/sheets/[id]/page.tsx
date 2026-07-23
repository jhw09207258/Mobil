import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { SpreadsheetLoader } from "./spreadsheet-loader";

export const dynamic = "force-dynamic";

export default async function SheetEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId, profile } = await requireUser();
  const supabase = await createClient();

  const { data: sheet } = await supabase
    .from("sheets")
    .select("id, owner_id, title, data, is_public, updated_at, yjs_state")
    .eq("id", id)
    .single();

  if (!sheet) notFound();

  let canEdit = sheet.owner_id === userId || profile.role === "admin" || sheet.is_public;
  if (!canEdit) {
    const { data: perm } = await supabase
      .from("sheet_permissions")
      .select("permission")
      .eq("sheet_id", id)
      .eq("user_id", userId)
      .maybeSingle();
    canEdit = perm?.permission === "edit";
  }

  return (
    <>
      <SpreadsheetLoader
        sheetId={sheet.id}
        initialTitle={sheet.title}
        initialData={sheet.data}
        initialYjsState={sheet.yjs_state}
        canEdit={canEdit}
        isOwner={sheet.owner_id === userId}
        isPublic={sheet.is_public}
        myShareId={userId}
        myName={profile.display_name || profile.email}
        myAvatarUrl={profile.avatar_url}
      />
    </>
  );
}
