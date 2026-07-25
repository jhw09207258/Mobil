import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { createCodeFileTab } from "./actions";
import { CodeList } from "./code-list";
import { CodeRepos } from "./code-repos";
import { listCodeRepositories } from "./repo-actions";
import { NewItemButton } from "../workspace/new-item-button";
import { listStarredIds } from "../starred-actions";

export const dynamic = "force-dynamic";

export default async function CodePage() {
  const { userId } = await requireUser();
  const supabase = await createClient();

  const [{ data: files }, starredIds, codeRepos] = await Promise.all([
    supabase
      .from("code_files")
      .select("id, owner_id, name, language, is_public, updated_at")
      // 코드 저장소에 속한 파일은 저장소 안에서 보여주므로 낱개 목록에서 뺀다.
      .is("code_repository_id", null)
      .order("updated_at", { ascending: false }),
    listStarredIds("code"),
    listCodeRepositories(),
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

        <h2 className="h-title" style={{ margin: "0 0 12px" }}>
          Code Spaces
        </h2>
        <CodeRepos repos={codeRepos} />

        <h2 className="h-title" style={{ margin: "8px 0 12px" }}>
          Standalone files
        </h2>
        <CodeList files={list} userId={userId} starredIds={starredIds} />
      </div>
    </>
  );
}
