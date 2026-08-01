"use server";

import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser as requireUser } from "@/lib/auth";
import { sendChatMessage } from "../chat/actions";
import { measure } from "@/lib/observability";

/**
 * "자료를 공유한다" 를 한 곳에 모은다.
 *
 * 지금까지 채팅 첨부는 링크일 뿐이어서, 받는 쪽에 권한이 없으면 아무것도
 * 열리지 않았다. 그래서 사람들이 파일 경로를 말로 불러 주는 일이 반복됐다.
 * 여기서는 "보낸다 = 볼 수 있게 한다" 로 묶는다 — 첨부와 동시에 그 대화의
 * 모든 멤버에게 열람 권한이 나간다(내가 소유자일 때). 소유자가 아니면 첨부는
 * 되지만 권한은 못 주므로, 받는 쪽 카드가 "권한 요청" 버튼을 보여 준다.
 */

export type ObjectKind = "document" | "code" | "sheet" | "mindmap" | "file" | "event";

export type ObjectCard = {
  kind: ObjectKind;
  id: string;
  title: string | null;
  subtitle: string | null;
  owner_id: string | null;
  owner_name: string | null;
  updated_at: string | null;
  size_bytes: number | null;
  mime_type: string | null;
  can_view: boolean;
  can_edit: boolean;
  object_exists: boolean;
};

export type AttachableObject = {
  kind: ObjectKind;
  id: string;
  title: string;
  subtitle: string | null;
  updated_at: string | null;
};

const KINDS: ObjectKind[] = ["document", "code", "sheet", "mindmap", "file", "event"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validRef(ref: { kind: string; id: string }): boolean {
  return KINDS.includes(ref.kind as ObjectKind) && UUID_RE.test(ref.id);
}

/** 첨부 칩 여러 개의 메타데이터를 한 번에. 칩마다 쿼리를 날리지 않기 위함. */
export async function getObjectCards(
  refs: { kind: string; id: string }[]
): Promise<ObjectCard[]> {
  await requireUser();
  const clean = refs.filter(validRef).slice(0, 200);
  if (clean.length === 0) return [];

  const supabase = await createClient();
  const { data, error } = await measure(supabase, "sharing.cards", async () =>
    supabase.rpc("get_object_cards", { p_refs: clean })
  );
  if (error || !data) return [];
  return data as ObjectCard[];
}

/** 첨부/공유 대상 후보 — 문서·시트·코드·링크그래프·파일·다가오는 일정. */
export async function listAttachables(query?: string): Promise<AttachableObject[]> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await measure(supabase, "sharing.attachable", async () =>
    supabase.rpc("list_attachable_objects", { p_query: query?.trim() || null, p_limit: 40 })
  );
  return (data ?? []) as AttachableObject[];
}

export type ShareOutcome = {
  /** 내가 권한을 줄 수 있는 사람인가(소유자/관리자). */
  canGrant: boolean;
  /** 이번에 새로 권한을 받은 사람 수. */
  granted: number;
  /** 나를 뺀 대화 인원. */
  members: number;
  /** 이미 볼 수 있던 사람 수. */
  already: number;
};

/** 대화 멤버 전원에게 열람(또는 편집) 권한을 준다. */
export async function shareWithConversation(
  kind: ObjectKind,
  id: string,
  conversationId: string,
  permission: "view" | "edit" = "view"
): Promise<ShareOutcome | { error: string }> {
  await requireUser();
  if (!validRef({ kind, id }) || !UUID_RE.test(conversationId)) {
    return { error: "Invalid share target." };
  }
  // 일정은 참석자 초대로 공유한다 — 오브젝트 권한 테이블이 없다.
  if (kind === "event") {
    return { canGrant: false, granted: 0, members: 0, already: 0 };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("share_object_with_conversation", {
    p_kind: kind,
    p_id: id,
    p_conversation: conversationId,
    p_permission: permission,
  });
  if (error) return { error: "Could not share with this conversation." };

  const r = (data ?? {}) as {
    can_grant?: boolean;
    granted?: number;
    members?: number;
    already?: number;
  };
  return {
    canGrant: !!r.can_grant,
    granted: r.granted ?? 0,
    members: r.members ?? 0,
    already: r.already ?? 0,
  };
}

/** 메시지 본문에 넣는 첨부 토큰. 제목의 `]` 는 토큰을 깨므로 지운다. */
function refToken(kind: ObjectKind, id: string, title: string): string {
  const safe = (title || "Untitled").replace(/[[\]|\n]/g, " ").trim().slice(0, 120);
  return `[[${kind}:${id}|${safe || "Untitled"}]]`;
}

export type SendToChatResult = { ok: true; share: ShareOutcome } | { error: string };

/**
 * 어디서든(파일 목록·에디터·일정) 자료를 대화로 보낸다.
 * 권한을 먼저 주고 메시지를 나중에 보낸다 — 알림 토스트가 뜬 순간 이미 열
 * 수 있어야 하기 때문이다.
 */
export async function sendItemToChat(
  kind: ObjectKind,
  id: string,
  title: string,
  conversationId: string,
  note?: string,
  permission: "view" | "edit" = "view"
): Promise<SendToChatResult> {
  await requireUser();
  if (!validRef({ kind, id }) || !UUID_RE.test(conversationId)) {
    return { error: "Invalid share target." };
  }

  const share = await shareWithConversation(kind, id, conversationId, permission);
  if ("error" in share) return share;

  const body = [note?.trim(), refToken(kind, id, title)].filter(Boolean).join("\n");
  const sent = await sendChatMessage(conversationId, body);
  if ("error" in sent) return { error: sent.error };

  return { ok: true, share };
}

/**
 * 권한이 없는 자료에 접근을 요청한다 — 소유자와의 DM 에 요청 메시지를 남긴다.
 * 소유자는 그 메시지의 카드에서 바로 "이 대화에 공유" 를 눌러 권한을 줄 수 있다.
 */
export async function requestAccess(
  kind: ObjectKind,
  id: string
): Promise<{ ok: true; ownerName: string; conversationId: string } | { error: string }> {
  const { profile, email } = await requireUser();
  if (!validRef({ kind, id })) return { error: "Invalid item." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_object_access", {
    p_kind: kind,
    p_id: id,
  });
  const info = (data ?? {}) as { found?: boolean; owner_id?: string; owner_name?: string };
  if (error || !info.found || !info.owner_id) {
    return { error: "This item no longer exists, or it is already yours." };
  }

  const { data: conversationId, error: dmError } = await supabase.rpc("start_chat_dm", {
    p_other: info.owner_id,
  });
  if (dmError || !conversationId) return { error: "Could not open a chat with the owner." };

  const me = profile.display_name || email;
  const sent = await sendChatMessage(
    conversationId,
    `${me} is requesting access to this ${kind}.\n${refToken(kind, id, kind)}\n` +
      `_Open the card above and choose “Share with this chat” to grant access._`
  );
  if ("error" in sent) return { error: sent.error };

  return { ok: true, ownerName: info.owner_name ?? "the owner", conversationId };
}

/**
 * 미리보기용 서명 URL — 다운로드가 아니라 화면에 그대로 띄우기 위한 것이라
 * `download` 플래그를 붙이지 않는다(붙이면 브라우저가 저장 대화상자를 연다).
 */
export async function getPreviewUrl(
  fileId: string
): Promise<{ url: string; mime: string | null; name: string; size: number | null } | { error: string }> {
  await requireUser();
  if (!UUID_RE.test(fileId)) return { error: "Invalid file." };

  const supabase = await createClient();
  const { data: file, error } = await supabase
    .from("files")
    .select("storage_path, mime_type, file_name, size_bytes")
    .eq("id", fileId)
    .maybeSingle();
  if (error || !file) return { error: "File not found — it may have been deleted or unshared." };

  const { data: signed, error: signErr } = await supabase.storage
    .from("files")
    .createSignedUrl(file.storage_path, 300);
  if (signErr || !signed) return { error: "Could not open a preview link." };

  return {
    url: signed.signedUrl,
    mime: file.mime_type,
    name: file.file_name,
    size: file.size_bytes,
  };
}
