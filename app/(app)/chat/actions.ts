"use server";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";

export type ChatConversation = {
  id: string;
  kind: "dm" | "group";
  title: string;
  member_count: number;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
  updated_at: string;
};

export type ChatMessage = {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_avatar_url: string | null;
  content: string;
  created_at: string;
};

export type ChatContact = {
  id: string;
  display_name: string | null;
  email: string;
  avatar_url: string | null;
};

export async function listChatConversations(): Promise<ChatConversation[]> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_chat_conversations");
  return data ?? [];
}

export async function getChatMessages(
  conversationId: string
): Promise<ChatMessage[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_chat_messages", {
    p_conversation: conversationId,
  });
  // RPC 는 최신순으로 잘라 오므로 화면 표시는 시간순으로 뒤집는다.
  return (data ?? []).reverse();
}

export async function sendChatMessage(
  conversationId: string,
  content: string
): Promise<ChatMessage | { error: string }> {
  const { userId, profile } = await requireUser();
  const text = content.trim();
  if (!text) return { error: "Message is empty." };
  if (text.length > 4000) return { error: "Message is too long (max 4,000 characters)." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({ conversation_id: conversationId, sender_id: userId, content: text })
    .select("id, sender_id, content, created_at")
    .single();
  if (error || !data) return { error: "Failed to send — you may no longer be a member." };

  return {
    ...data,
    sender_name: profile.display_name || profile.email,
    sender_avatar_url: profile.avatar_url,
  };
}

export async function startDm(
  otherUserId: string
): Promise<{ id: string } | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_chat_dm", {
    p_other: otherUserId,
  });
  if (error || !data) return { error: "Could not start the conversation." };
  return { id: data };
}

export async function createGroup(
  title: string,
  memberIds: string[]
): Promise<{ id: string } | { error: string }> {
  await requireUser();
  if (!title.trim()) return { error: "Give the group a name." };
  if (memberIds.length === 0) return { error: "Pick at least one member." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_chat_group", {
    p_title: title.trim(),
    p_members: memberIds,
  });
  if (error || !data) return { error: "Could not create the group." };
  return { id: data };
}

export async function addMembers(
  conversationId: string,
  memberIds: string[]
): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  if (memberIds.length === 0) return { error: "Pick at least one member." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_chat_members", {
    p_conversation: conversationId,
    p_members: memberIds,
  });
  if (error) return { error: "Could not add members." };
  return { ok: true };
}

export async function markChatRead(conversationId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("mark_chat_read", { p_conversation: conversationId });
}

export async function leaveConversation(
  conversationId: string
): Promise<{ ok: true } | { error: string }> {
  const { userId } = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("chat_members")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
  if (error) return { error: "Could not leave the conversation." };
  return { ok: true };
}

export async function deleteConversation(
  conversationId: string
): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("chat_conversations")
    .delete()
    .eq("id", conversationId);
  if (error) return { error: "Only the creator can delete a conversation." };
  return { ok: true };
}

export async function listChatContacts(): Promise<ChatContact[]> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_coworkers");
  return (data ?? []).map((c) => ({
    id: c.id,
    display_name: c.display_name,
    email: c.email,
    avatar_url: c.avatar_url,
  }));
}

/** 메시지에 첨부할 수 있는 내 워크스페이스 항목(문서/코드/시트/마인드맵).
 * RLS 가 접근 가능 범위를 강제하므로 여기서는 최근 항목만 모은다. */
export type AttachableItem = {
  kind: "document" | "code" | "sheet" | "mindmap";
  id: string;
  title: string;
};

export async function listAttachableItems(): Promise<AttachableItem[]> {
  await requireUser();
  const supabase = await createClient();
  const [docs, code, sheets, maps] = await Promise.all([
    supabase.from("documents").select("id, title").order("updated_at", { ascending: false }).limit(25),
    supabase.from("code_files").select("id, name").order("updated_at", { ascending: false }).limit(25),
    supabase.from("sheets").select("id, title").order("updated_at", { ascending: false }).limit(25),
    supabase.from("mind_maps").select("id, title").order("updated_at", { ascending: false }).limit(25),
  ]);
  const out: AttachableItem[] = [];
  for (const d of docs.data ?? []) out.push({ kind: "document", id: d.id, title: d.title || "Untitled" });
  for (const c of code.data ?? []) out.push({ kind: "code", id: c.id, title: c.name });
  for (const s of sheets.data ?? []) out.push({ kind: "sheet", id: s.id, title: s.title || "Untitled" });
  for (const m of maps.data ?? []) out.push({ kind: "mindmap", id: m.id, title: m.title || "Untitled" });
  return out;
}
