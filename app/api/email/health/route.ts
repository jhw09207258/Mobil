import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { appUrl, emailConfigured, sendEmail } from "@/lib/email";

// 알림 메일 진단 엔드포인트(관리자 전용).
//   GET /api/email/health              — 설정 여부만 본다(메일은 안 보냄).
//   GET /api/email/health?send=1       — 자기 자신에게 실제로 한 통 보낸다.
// 키 값은 응답에 싣지 않는다 — 이름과 말미 4자리만.
export const maxDuration = 30;

const tail = (v?: string) => (v ? `…${v.slice(-4)}` : null);

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  const env = {
    RESEND_API_KEY: tail(process.env.RESEND_API_KEY),
    EMAIL_FROM: process.env.EMAIL_FROM ?? null,
    app_url: appUrl() || null,
  };
  const configured = emailConfigured();

  if (!configured) {
    return NextResponse.json({
      ok: false,
      configured,
      env,
      hint: "Set RESEND_API_KEY and EMAIL_FROM in the deployment environment, then redeploy.",
    });
  }

  if (request.nextUrl.searchParams.get("send") !== "1") {
    return NextResponse.json({ ok: true, configured, env, sent: false });
  }

  const res = await sendEmail({
    to: user.email ?? "",
    subject: "Possion — notification test",
    text: "This is a test of Possion's chat notification email. Nothing is wrong.",
    html: "<p>This is a test of Possion&rsquo;s chat notification email. Nothing is wrong.</p>",
  });
  return NextResponse.json({
    ok: "ok" in res,
    configured,
    env,
    sent: "ok" in res,
    to: user.email ?? null,
    detail: "error" in res ? res.error : null,
  });
}
