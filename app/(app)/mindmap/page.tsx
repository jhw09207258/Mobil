import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { createMindMapTab } from "./actions";
import { MindMapList } from "./mindmap-list";
import { NewItemButton } from "../workspace/new-item-button";
import { ImportOutlineButton } from "./import-outline-button";

export const dynamic = "force-dynamic";

export default async function MindMapPage() {
  const { userId } = await requireUser();
  const supabase = await createClient();

  const { data: maps } = await supabase
    .from("mind_maps")
    .select("id, owner_id, title, is_public, updated_at")
    .order("updated_at", { ascending: false });

  return (
    <>
      <div className="content">
        <div className="page-head">
          <div>
            <h1 className="page-h">Link Graph</h1>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <ImportOutlineButton />
            <NewItemButton kind="mindmap" label="New map" create={createMindMapTab} />
          </div>
        </div>

        <MindMapList maps={maps ?? []} userId={userId} />
      </div>
    </>
  );
}
