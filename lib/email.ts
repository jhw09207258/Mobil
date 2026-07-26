import "server-only";

/**
 * 메일 발송 — Resend REST 를 fetch 로 직접 부른다.
 *
 * SDK 를 넣지 않는 이유: 쓰는 건 엔드포인트 하나뿐이고, 의존성이 늘면 서버리스
 * 번들과 업그레이드 부담만 커진다.
 *
 * 키가 없으면 조용히 건너뛴다 — 알림 메일이 안 나갔다고 메시지 전송 자체가
 * 실패하면 안 된다.
 */

const ENDPOINT = "https://api.resend.com/emails";

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
}

/** 앱으로 돌아오는 링크. Vercel 은 배포마다 도메인을 주므로 그것도 받아둔다. */
export function appUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return vercel ? `https://${vercel}` : "";
}

export async function sendEmail(mail: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: true } | { error: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { error: "Email is not configured on the server." };

  // 메일 서버가 느리다고 요청이 매달려 있으면 안 된다.
  const abort = AbortSignal.timeout(10_000);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
      signal: abort,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { error: `${res.status} ${detail.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Send failed." };
  }
}

const ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** 사용자가 쓴 글이 메일 본문의 HTML 로 해석되지 않게 한다. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPE[c]);
}
