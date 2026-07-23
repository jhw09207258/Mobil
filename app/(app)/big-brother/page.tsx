import { requireUser } from "@/lib/auth";
import { listConversations } from "../sophia/actions";
import { BigBrotherShell } from "./big-brother-shell";

export const dynamic = "force-dynamic";

export default async function BigBrotherPage() {
  await requireUser();
  const conversations = await listConversations();

  return (
    <>
      <BigBrotherShell initialConversations={conversations} />
    </>
  );
}
