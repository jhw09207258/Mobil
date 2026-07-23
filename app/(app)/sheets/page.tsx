import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { createSheetTab, importSheet } from "./actions";
import { SheetList } from "./sheet-list";
import { NewItemButton } from "../workspace/new-item-button";
import { ImportItemButton } from "../workspace/import-item-button";
import { listStarredIds } from "../starred-actions";

export const dynamic = "force-dynamic";

export default async function SheetsPage() {
  const { userId } = await requireUser();
  const supabase = await createClient();

  const [{ data: sheets }, starredIds] = await Promise.all([
    supabase
      .from("sheets")
      .select("id, owner_id, title, is_public, updated_at")
      .order("updated_at", { ascending: false }),
    listStarredIds("sheet"),
  ]);

  return (
    <>
      <div className="content">
        <div className="page-head">
          <div>
            <h1 className="page-h">Table</h1>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <ImportItemButton
              kind="sheet"
              label="Import file"
              accept=".csv,.xlsx,.xls"
              importAction={importSheet}
            />
            <NewItemButton kind="sheet" label="New sheet" create={createSheetTab} />
          </div>
        </div>

        <SheetList sheets={sheets ?? []} userId={userId} starredIds={starredIds} />
      </div>
    </>
  );
}
