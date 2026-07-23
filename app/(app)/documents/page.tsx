import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { createDocumentTab, importDocument } from "./actions";
import { DocumentsList } from "./documents-list";
import { NewItemButton } from "../workspace/new-item-button";
import { ImportItemButton } from "../workspace/import-item-button";
import { listStarredIds } from "../starred-actions";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const { userId } = await requireUser();
  const supabase = await createClient();

  const [{ data: docs }, starredIds] = await Promise.all([
    supabase
      .from("documents")
      .select("id, owner_id, title, is_public, updated_at")
      .order("updated_at", { ascending: false }),
    listStarredIds("document"),
  ]);

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">Docs +</span>
        <span className="crumb">WORKSPACE / DOCS +</span>
      </div>
      <div className="content">
        <div className="page-head">
          <div>
            <h1 className="page-h">Docs +</h1>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <ImportItemButton
              kind="document"
              label="Import file"
              accept=".txt,.docx,.hwp,.hwpx,.pages"
              importAction={importDocument}
            />
            <NewItemButton kind="document" label="New document" create={createDocumentTab} />
          </div>
        </div>

        <DocumentsList docs={docs ?? []} userId={userId} starredIds={starredIds} />
      </div>
    </>
  );
}
