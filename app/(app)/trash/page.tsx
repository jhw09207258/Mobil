import { requireUser } from "@/lib/auth";
import { listTrash } from "./actions";
import { TrashList } from "./trash-list";

export const dynamic = "force-dynamic";

export default async function TrashPage() {
  await requireUser();
  const items = await listTrash();

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-h">Trash</h1>
          <p className="page-sub">
            Deleted items are kept for 18 hours, then removed permanently.
          </p>
        </div>
      </div>

      <TrashList items={items} />
    </div>
  );
}
