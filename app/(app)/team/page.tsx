import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listTeamMembers } from "./actions";
import { TeamManagePanel } from "./team-manage-panel";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const { userId, profile } = await requireUser();
  if (!profile.active_team_id) redirect("/choose-team");

  const supabase = await createClient();
  const [{ data: team }, members] = await Promise.all([
    supabase
      .from("teams")
      .select("id, name, description, is_open, leader_id, created_at")
      .eq("id", profile.active_team_id)
      .single(),
    listTeamMembers(profile.active_team_id),
  ]);

  // 레이아웃의 active_team_id 확인 직후 팀이 삭제되는 아주 드문 경합 대비.
  if (!team) redirect("/choose-team");

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-h">{team.name}</h1>
          <p className="page-sub">{team.description || "No description."}</p>
        </div>
      </div>
      <TeamManagePanel team={team} initialMembers={members} selfId={userId} />
    </div>
  );
}
