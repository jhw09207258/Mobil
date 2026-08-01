"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser as requireUser } from "@/lib/auth";

export type MyTeamRow = {
  id: string;
  name: string;
  description: string | null;
  is_open: boolean;
  member_count: number;
  leader_id: string;
  is_leader: boolean;
  status: "active" | "pending";
  is_active_team: boolean;
};

export type TeamSearchRow = {
  id: string;
  name: string;
  description: string | null;
  is_open: boolean;
  member_count: number;
  leader_name: string;
  my_status: "active" | "pending" | null;
};

export type TeamMemberRow = {
  id: string;
  display_name: string | null;
  email: string;
  avatar_url: string | null;
  status: "active" | "pending";
  is_leader: boolean;
  joined_at: string;
};

type ActionResult = { ok: true } | { error: string };

export async function listMyTeams(): Promise<MyTeamRow[]> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_my_teams");
  return (data ?? []) as MyTeamRow[];
}

export async function searchTeamsAction(query: string): Promise<TeamSearchRow[]> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.rpc("search_teams", { p_query: query.trim() });
  return (data ?? []) as TeamSearchRow[];
}

export async function listTeamMembers(teamId: string): Promise<TeamMemberRow[]> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_team_members", { p_team: teamId });
  return (data ?? []) as TeamMemberRow[];
}

/** 팀을 만들고 곧바로 그 팀으로 전환한다(create_team RPC 가 active_team_id 도 같이 옮긴다). */
export async function createTeam(
  name: string,
  description: string,
  isOpen: boolean
): Promise<{ id: string } | { error: string }> {
  await requireUser();
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) return { error: "Team name must be 1-80 characters." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_team", {
    p_name: trimmed,
    p_description: description.trim() || null,
    p_is_open: isOpen,
  });
  if (error || !data) return { error: "Could not create the team." };
  revalidatePath("/", "layout");
  return { id: data };
}

export async function requestJoinTeam(teamId: string): Promise<{ status: "joined" | "pending" } | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_join_team", { p_team: teamId });
  if (error) return { error: error.message.includes("already") ? error.message : "Could not send the join request." };
  revalidatePath("/", "layout");
  return { status: data === "joined" ? "joined" : "pending" };
}

export async function setActiveTeam(teamId: string): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_active_team", { p_team: teamId });
  if (error) return { error: "Could not switch teams." };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function leaveTeam(teamId: string): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("leave_team", { p_team: teamId });
  if (error) return { error: error.message || "Could not leave the team." };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function approveMember(teamId: string, userId: string): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_team_member", { p_team: teamId, p_user: userId });
  if (error) return { error: "Could not approve this member." };
  revalidatePath("/team");
  return { ok: true };
}

export async function rejectMember(teamId: string, userId: string): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_team_member", { p_team: teamId, p_user: userId });
  if (error) return { error: "Could not reject this request." };
  revalidatePath("/team");
  return { ok: true };
}

export async function removeMember(teamId: string, userId: string): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_team_member", { p_team: teamId, p_user: userId });
  if (error) return { error: error.message || "Could not remove this member." };
  revalidatePath("/team");
  return { ok: true };
}

export async function transferLeadership(teamId: string, newLeaderId: string): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_team_leadership", {
    p_team: teamId,
    p_new_leader: newLeaderId,
  });
  if (error) return { error: "Could not transfer leadership." };
  revalidatePath("/team");
  return { ok: true };
}

export async function setTeamOpen(teamId: string, isOpen: boolean): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_team_open", { p_team: teamId, p_is_open: isOpen });
  if (error) return { error: "Could not change the join setting." };
  revalidatePath("/team");
  return { ok: true };
}

export async function deleteTeam(teamId: string): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_team", { p_team: teamId });
  if (error) return { error: "Could not delete the team." };
  revalidatePath("/", "layout");
  return { ok: true };
}
