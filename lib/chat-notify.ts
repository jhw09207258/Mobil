import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appUrl, emailConfigured, escapeHtml, sendEmail } from "./email";

/**
 * 새 채팅 메시지를 못 보고 지나치지 않게, 안 보고 있는 멤버에게 메일로 알린다.
 *
 * 누구에게 보낼지는 DB 가 정한다(claim_chat_email_recipients) — 최근에 읽은
 * 사람과 방금 알림을 받은 사람을 걸러내고, 고른 대상에 발송 시각을 같은
 * 문장에서 찍어 중복 발송을 막는다.
 *
 * 메일 본문에 메시지 전문을 넣지 않는다. 메일함은 앱보다 통제가 약한 곳이고,
 * 팀 대화 내용이 그리로 새어 나가면 되돌릴 수 없다. 누가 어디에 보냈는지만
 * 알리고 나머지는 앱에서 보게 한다.
 */

type Recipient = { user_id: string; email: string; display_name: string | null };

export async function notifyChatByEmail(
  supabase: SupabaseClient,
  args: { messageId: string; conversationId: string; senderName: string; conversationTitle: string | null }
): Promise<void> {
  if (!emailConfigured()) return;

  const { data, error } = await supabase.rpc("claim_chat_email_recipients", {
    p_message: args.messageId,
  });
  if (error || !data?.length) return;

  const where = args.conversationTitle
    ? `“${args.conversationTitle}”`
    : "a direct message";
  const subject = args.conversationTitle
    ? `${args.senderName} messaged ${args.conversationTitle}`
    : `${args.senderName} sent you a message`;
  const base = appUrl();
  const link = base ? `${base}/chat?c=${encodeURIComponent(args.conversationId)}` : "";

  await Promise.all(
    (data as Recipient[]).map((r) =>
      sendEmail({ to: r.email, subject, ...body(r, args.senderName, where, link, base) }).catch(
        () => undefined
      )
    )
  );
}

function body(r: Recipient, sender: string, where: string, link: string, base: string) {
  const hi = r.display_name ? `${r.display_name},` : "Hello,";
  const text = [
    hi,
    "",
    `${sender} sent a new message in ${where} on Possion.`,
    link ? `Open the conversation: ${link}` : "",
    "",
    "You are receiving this because email notifications are on for your account.",
    base ? `Turn them off in Settings: ${base}/settings` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const settings = base ? `${base}/settings` : "";
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#1c1c1e">
  <p>${escapeHtml(hi)}</p>
  <p><strong>${escapeHtml(sender)}</strong> sent a new message in ${escapeHtml(where)} on Possion.</p>
  ${link ? `<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:9px 16px;background:#1c1c1e;color:#fff;border-radius:8px;text-decoration:none">Open the conversation</a></p>` : ""}
  <p style="color:#8a8a8e;font-size:12.5px;margin-top:28px">
    You are receiving this because email notifications are on for your account.${
      settings ? ` <a href="${escapeHtml(settings)}" style="color:#8a8a8e">Turn them off in Settings</a>.` : ""
    }
  </p>
</div>`;

  return { text, html };
}
