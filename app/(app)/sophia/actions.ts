"use server";

import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser as requireUser } from "@/lib/auth";

export type ConversationRow = { id: string; title: string; updated_at: string };
export type MessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export async function listConversations(): Promise<ConversationRow[]> {
  const { userId } = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_conversations")
    .select("id, title, updated_at")
    .eq("owner_id", userId)
    .order("updated_at", { ascending: false });
  return data ?? [];
}

export async function createConversation(): Promise<
  ConversationRow | { error: string }
> {
  const { userId } = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_conversations")
    .insert({ owner_id: userId })
    .select("id, title, updated_at")
    .single();
  if (error || !data) return { error: "Failed to start a new chat." };
  return data;
}

export async function getMessages(conversationId: string): Promise<MessageRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

export async function deleteConversation(
  conversationId: string
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  // RLS 로 막히면 delete 는 "0행 삭제 + 에러 없음" 으로 조용히 성공한 척한다.
  // 지운 행을 돌려받아 실제로 지워졌는지 확인해야 UI 가 거짓말을 안 한다.
  const { data, error } = await supabase
    .from("ai_conversations")
    .delete()
    .eq("id", conversationId)
    .select("id");
  if (error) return { error: "Failed to delete chat." };
  if (!data || data.length === 0) {
    return { error: "That chat could not be deleted — it may not be yours." };
  }
  return { ok: true };
}

/** 대화 이름 변경. */
export async function renameConversation(
  conversationId: string,
  title: string
): Promise<{ ok: true; title: string } | { error: string }> {
  const trimmed = title.trim().slice(0, 120);
  if (!trimmed) return { error: "Give the chat a name." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_conversations")
    .update({ title: trimmed })
    .eq("id", conversationId)
    .select("id");
  if (error) return { error: "Rename failed." };
  if (!data || data.length === 0) {
    return { error: "That chat could not be renamed — it may not be yours." };
  }
  return { ok: true, title: trimmed };
}
