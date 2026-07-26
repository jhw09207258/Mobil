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
    (data as Recipient[]).map(async (r) => {
      const sent = await sendEmail({
        to: r.email,
        subject,
        ...body(r, args.senderName, where, link, base),
      }).catch((e) => ({ error: e instanceof Error ? e.message : "unknown" }));
      // sendEmail 은 실패해도 던지지 않고 { error } 를 돌려주므로, 위 .catch
      // 만으로는 절대 못 잡는다 — 그래서 이렇게 직접 결과를 봐야 Resend 가
      // 실제로 무슨 이유로 거절했는지(도메인 미인증 등) 로그에 남는다.
      if ("error" in sent) {
        console.error(`[chat-notify] send to ${r.email} failed: ${sent.error}`);
      }
    })
  );
}

function body(r: Recipient, sender: string, where: string, link: string, base: string) {
  const hi = r.display_name ? `${r.display_name},` : "Hello,";
  const settings = base ? `${base}/settings` : "";
  const year = new Date().getFullYear();

  const text = [
    hi,
    "",
    `${sender} sent a new message in ${where} on Possion.`,
    link ? `Open the conversation: ${link}` : "",
    "",
    "You are receiving this because email notifications are on for your account.",
    settings ? `Turn them off: ${settings}` : "",
    "",
    `© ${year} Yegrina Haute Group. Distributed under the Yegrina Haute Group License.`,
  ]
    .filter(Boolean)
    .join("\n");

  // 로그인 화면의 벡터 파티클 배경을 정지 프레임으로 구운 히어로 이미지 —
  // 메일은 캔버스/애니메이션을 그릴 수 없으니, 같은 수학으로 한 장을 미리
  // 렌더링해 두었다(public/email/particle-hero.jpg). 앱 주소를 모르는 극히
  // 드문 경우(base 가 빈 문자열, 로컬 미설정 환경)에만 이미지를 빼고 텍스트
  // 워드마크로 대체한다 — 상대경로 <img> 는 메일 클라이언트에서 절대 못 뜬다.
  const hero = base
    ? `<img src="${escapeHtml(base)}/email/particle-hero.jpg" width="600" alt="Possion" style="display:block;width:100%;max-width:600px;height:auto;background:#050505" />`
    : `<div style="background:#050505;padding:64px 0;text-align:center;font-family:'Avenir Next',Avenir,-apple-system,sans-serif;font-weight:100;letter-spacing:-0.05em;font-size:40px;color:#f2f2f2">Possion</div>`;

  // color-scheme / supported-color-schemes: 안 붙이면 애플 메일·아웃룩 다크모드가
  // 이미 어두운 이 레이아웃을 "라이트 메일"로 오인해 색을 또 뒤집어버린다.
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="color-scheme" content="dark light" />
<meta name="supported-color-schemes" content="dark light" />
</head>
<body style="margin:0;padding:0;background:#000000">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#000000">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
<tr><td>${hero}</td></tr>
<tr><td style="background:#0b0b0c;border:1px solid #1c1c1e;border-top:none;padding:36px 36px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <p style="margin:0 0 14px;color:#f2f2f2;font-size:16px;line-height:1.5">${escapeHtml(hi)}</p>
  <p style="margin:0 0 26px;color:#c9c9cc;font-size:15px;line-height:1.6">
    <strong style="color:#f2f2f2">${escapeHtml(sender)}</strong> sent a new message in ${escapeHtml(where)}.
  </p>
  ${
    link
      ? `<a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 26px;background:#f2f2f2;color:#0b0b0c;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Open Possion &rarr;</a>`
      : ""
  }
</td></tr>
<tr><td style="padding:22px 36px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#6e6e73;font-size:11.5px;line-height:1.7">
  You are receiving this because email notifications are on for your account.${
    settings ? ` <a href="${escapeHtml(settings)}" style="color:#8a8a8e">Turn them off</a>.` : ""
  }
  <br /><br />
  &copy; ${year} Yegrina Haute Group. All rights reserved.<br />
  Distributed under the Yegrina Haute Group License.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { text, html };
}
