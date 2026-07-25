import { CodeRepos } from "./code-repos";
import { listCodeRepositories } from "./repo-actions";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CodePage() {
  await requireUser();
  // 코드 파일은 Code Space 안에서만 존재한다(0055) — 낱개 파일 목록은 없다.
  const codeRepos = await listCodeRepositories();

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-h">Codespace</h1>
          <p className="page-sub">
            Each Code Space is a project the agent can work across. Build one with Big
            Brother, or import a repository from GitHub.
          </p>
        </div>
      </div>

      <CodeRepos repos={codeRepos} />
    </div>
  );
}
