"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { isNextControlFlowError } from "@/lib/next-control-flow";

export type TeamSearchRow = {
  id: string;
  name: string;
  description: string | null;
  is_open: boolean;
  member_count: number;
  leader_name: string;
  my_status: "active" | "pending" | null;
};

/** 팀 이름으로 검색 — 빈 문자열이면 인원순 상위 30개(둘러보기용). */
export async function searchTeams(query: string): Promise<TeamSearchRow[]> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.rpc("search_teams", { p_query: query.trim() });
  return (data ?? []) as TeamSearchRow[];
}

export type CreateTeamState = { error: string } | null;

/** 팀을 만들고 그 자리에서 팀장이 되어 곧장 들어간다. */
export async function createTeamAction(
  _prev: CreateTeamState,
  formData: FormData
): Promise<CreateTeamState> {
  const name = String(formData.get("name") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const isOpen = formData.get("is_open") === "on";

  if (!name || name.length > 80) {
    return { error: "Team name must be 1-80 characters." };
  }

  let ok = false;
  try {
    await requireUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("create_team", {
      p_name: name,
      p_description: description || null,
      p_is_open: isOpen,
    });
    if (error) return { error: "Could not create the team. Please try again." };
    ok = true;
  } catch (e) {
    if (isNextControlFlowError(e)) throw e;
    console.error("[choose-team:createTeamAction] unexpected failure:", e instanceof Error ? e.message : e);
    return { error: "Something went wrong on our end. Please try again in a moment." };
  }
  if (ok) redirect("/dashboard");
  return null;
}

/** 열림 팀이면 즉시 합류(→ 대시보드로), 닫힘 팀이면 대기 신청만 남긴다. */
export async function joinTeamAction(
  teamId: string
): Promise<{ status: "joined" } | { status: "pending" } | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_join_team", { p_team: teamId });
  if (error) return { error: error.message.includes("already") ? error.message : "Could not send the join request." };
  if (data === "joined") redirect("/dashboard");
  return { status: "pending" };
}
