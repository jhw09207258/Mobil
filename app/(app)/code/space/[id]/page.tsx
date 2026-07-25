import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getCodeSpace, listCodeRepoFiles } from "../../repo-actions";
import { CodeSpaceWorkspace } from "./workspace";
import "./code-space.css";

export const dynamic = "force-dynamic";

export default async function CodeSpacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const [space, files] = await Promise.all([getCodeSpace(id), listCodeRepoFiles(id)]);
  if (!space) notFound();

  return (
    <CodeSpaceWorkspace
      spaceId={space.id}
      spaceName={space.name}
      initialFiles={files}
      github={{ owner: space.github_owner, repo: space.github_repo }}
    />
  );
}
