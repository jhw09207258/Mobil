import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { createDocumentTab, importDocument } from "./actions";
import { DocumentsList } from "./documents-list";
import { NewItemButton } from "../workspace/new-item-button";
import { ImportItemButton } from "../workspace/import-item-button";
import { listStarredIds } from "../starred-actions";
import "./documents.css";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const { userId } = await requireUser();
  const supabase = await createClient();

  const [{ data: docs }, starredIds] = await Promise.all([
    supabase
      .from("documents")
      .select("id, owner_id, title, visibility, updated_at")
      .order("updated_at", { ascending: false }),
    listStarredIds("document"),
  ]);

  const rows = docs ?? [];
  const mineCount = rows.filter((d) => d.owner_id === userId).length;
  const publicCount = rows.filter((d) => d.visibility === "public").length;

  return (
    <>
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

        <div className="doc-stats-row">
          <div className="doc-stat-card">
            <div className="stat-val">{rows.length}</div>
            <div className="stat-label label">TOTAL</div>
          </div>
          <div className="doc-stat-card">
            <div className="stat-val">{mineCount}</div>
            <div className="stat-label label">MINE</div>
          </div>
          <div className="doc-stat-card">
            <div className="stat-val">{rows.length - mineCount}</div>
            <div className="stat-label label">SHARED WITH ME</div>
          </div>
          <div className="doc-stat-card">
            <div className="stat-val">{publicCount}</div>
            <div className="stat-label label">PUBLIC</div>
          </div>
        </div>

        <DocumentsList docs={rows} userId={userId} starredIds={starredIds} />
      </div>
    </>
  );
}
