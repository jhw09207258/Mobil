"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser as requireUser } from "@/lib/auth";
import { notifyChatMessage } from "@/lib/chat-notify";
import type { Json } from "@/lib/database.types";

export type ChatConversation = {
  id: string;
  kind: "dm" | "group";
  title: string;
  avatar_url: string | null;
  member_count: number;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
  updated_at: string;
};

export type ChatReaction = { emoji: string; count: number; reacted_by_me: boolean };

export type ChatMessage = {
  id: string;
  /** Big Brother 가 보낸 메시지는 보낸 사람이 없다(is_bot 이 true). */
  sender_id: string | null;
  is_bot?: boolean;
  sender_name: string;
  sender_avatar_url: string | null;
  content: string;
  created_at: string;
  edited_at?: string | null;
  reply_to_id?: string | null;
  reply_to_sender_name?: string | null;
  reply_to_content?: string | null;
  reactions?: ChatReaction[];
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

// get_chat_messages 의 reactions 는 jsonb(Json) 로 내려오므로 실제 형태
// (ChatReaction[])로 좁혀준다 — null 이면 반응 없음.
function toChatMessage(row: Omit<ChatMessage, "reactions"> & { reactions: Json }): ChatMessage {
  return { ...row, reactions: (row.reactions as unknown as ChatReaction[] | null) ?? [] };
}

export async function getChatMessages(
  conversationId: string
): Promise<ChatMessage[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_chat_messages", {
    p_conversation: conversationId,
  });
  // RPC 는 최신순으로 잘라 오므로 화면 표시는 시간순으로 뒤집는다.
  return (data ?? []).map(toChatMessage).reverse();
}

export async function sendChatMessage(
  conversationId: string,
  content: string,
  replyToId?: string | null
): Promise<ChatMessage | { error: string }> {
  const { userId } = await requireUser();
  const text = content.trim();
  if (!text) return { error: "Message is empty." };
  if (text.length > 4000) return { error: "Message is too long (max 4,000 characters)." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({ conversation_id: conversationId, sender_id: userId, content: text, reply_to_id: replyToId || null })
    .select("id")
    .single();
  if (error || !data) return { error: "Failed to send — you may no longer be a member." };

  // get_chat_messages 가 답장 미리보기·공감 집계를 이미 계산해 주므로, 방금
  // 넣은 메시지 하나만 다시 읽어 그대로 재사용한다(별도 RPC 불필요).
  const { data: rows } = await supabase.rpc("get_chat_messages", {
    p_conversation: conversationId,
    p_limit: 1,
  });
  if (!rows?.[0]) return { error: "Message sent, but couldn't load it back." };

  // 안 보고 있는 멤버에게 알린다(푸시 우선, 못 받는 사람만 메일). 응답을
  // 붙잡지 않도록 after() 안에서 돌리고, 실패해도 메시지 전송 결과에는 손대지
  // 않는다 — 알림은 부가 기능이다.
  const sent = toChatMessage(rows[0]);
  after(async () => {
    try {
      const { data: conv } = await supabase
        .from("chat_conversations")
        .select("kind, title")
        .eq("id", conversationId)
        .maybeSingle();
      await notifyChatMessage(supabase, {
        messageId: sent.id,
        conversationId,
        senderName: sent.sender_name || "Someone",
        conversationTitle: conv?.kind === "group" ? conv.title : null,
      });
    } catch {
      /* 알림 실패는 조용히 넘긴다. */
    }
  });

  return sent;
}

export async function toggleReaction(
  messageId: string,
  emoji: string
): Promise<{ ok: true; active: boolean } | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("toggle_chat_reaction", {
    p_message: messageId,
    p_emoji: emoji,
  });
  if (error) return { error: "Failed to react." };
  return { ok: true, active: !!data };
}

export async function editChatMessage(
  messageId: string,
  content: string
): Promise<{ ok: true; edited_at: string } | { error: string }> {
  const { userId } = await requireUser();
  const text = content.trim();
  if (!text) return { error: "Message can't be empty." };
  if (text.length > 4000) return { error: "Message is too long (max 4,000 characters)." };
  const supabase = await createClient();
  const editedAt = new Date().toISOString();
  const { error } = await supabase
    .from("chat_messages")
    .update({ content: text, edited_at: editedAt })
    .eq("id", messageId)
    .eq("sender_id", userId);
  if (error) return { error: "Failed to edit — you can only edit your own messages." };
  return { ok: true, edited_at: editedAt };
}

export async function deleteChatMessage(
  messageId: string
): Promise<{ ok: true } | { error: string }> {
  const { userId } = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("chat_messages")
    .delete()
    .eq("id", messageId)
    .eq("sender_id", userId);
  if (error) return { error: "Failed to delete — you can only delete your own messages." };
  return { ok: true };
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

export type ChatMemberInfo = {
  user_id: string;
  name: string;
  avatar_url: string | null;
  last_read_at: string;
};

/** 멤버 목록 + 각자의 last_read_at — 읽음 표시(read receipt) 계산용. */
export async function getChatMembers(conversationId: string): Promise<ChatMemberInfo[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_chat_members", {
    p_conversation: conversationId,
  });
  return data ?? [];
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

/** 워크스페이스 탭(스플릿 뷰)에서 채팅을 열 때 필요한 초기 데이터 한 번에. */
export async function getChatBootstrap(): Promise<{
  selfId: string;
  selfName: string;
  conversations: ChatConversation[];
  contacts: ChatContact[];
}> {
  const { userId, email, profile } = await requireUser();
  const [conversations, contacts] = await Promise.all([
    listChatConversations(),
    listChatContacts(),
  ]);
  return {
    selfId: userId,
    selfName: profile.display_name || email,
    conversations,
    contacts,
  };
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

/** 이 대화에 Big Brother 가 들어와 있는지. */
export async function getBigBrotherEnabled(conversationId: string): Promise<boolean> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("chat_conversations")
    .select("bigbrother_enabled")
    .eq("id", conversationId)
    .maybeSingle();
  return !!data?.bigbrother_enabled;
}

/** 초대/해제 — 그 대화의 멤버만(SQL 쪽에서도 한 번 더 막는다). */
export async function setBigBrother(
  conversationId: string,
  enabled: boolean
): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_bigbrother", {
    p_conversation: conversationId,
    p_enabled: enabled,
  });
  if (error) return { error: "Could not change Big Brother for this chat." };
  return { ok: true };
}
