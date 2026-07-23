import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { createCodeFileTab } from "./actions";
import { CodeList } from "./code-list";
import { NewItemButton } from "../workspace/new-item-button";
import { listStarredIds } from "../starred-actions";

export const dynamic = "force-dynamic";

export default async function CodePage() {
  const { userId } = await requireUser();
  const supabase = await createClient();

  const [{ data: files }, starredIds] = await Promise.all([
    supabase
      .from("code_files")
      .select("id, owner_id, name, language, is_public, updated_at")
      .order("updated_at", { ascending: false }),
    listStarredIds("code"),
  ]);

  const list = files ?? [];

  return (
    <>
      <div className="content">
        <div className="page-head">
          <div>
            <h1 className="page-h">Code</h1>
          </div>
          <NewItemButton kind="code" label="New code file" create={createCodeFileTab} />
        </div>

        <CodeList files={list} userId={userId} starredIds={starredIds} />
      </div>
    </>
  );
}
