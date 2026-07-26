import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { appUrl, emailConfigured, sendEmail } from "@/lib/email";

// 알림 메일 진단 엔드포인트(관리자 전용).
//   GET /api/email/health                       — 설정 여부만 본다(메일은 안 보냄).
//   GET /api/email/health?send=1                — 자기 자신에게 실제로 한 통 보낸다.
//   GET /api/email/health?send=1&to=누군가@메일   — 다른 주소로 보내본다. 발신
//     로직(누구를 고를지)과 실제 배달(Resend 가 받아들이는지)을 분리해서
//     확인할 때 쓴다 — claim 은 성공했는데 그 사람에게 메일이 안 갔다면,
//     문제는 우리 코드가 아니라 Resend 쪽(도메인 미인증 등)이다.
// 키 값은 응답에 싣지 않는다 — 이름과 말미 4자리만.
export const maxDuration = 30;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const tail = (v?: string) => (v ? `...${v.slice(-4)}` : null);

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

  // send=1 은 실제로 메일을 한 통 내보내는 부수효과가 있는데 GET 이다 — 관리자가
  // 로그인한 상태로 악성 링크(top-level navigation)를 열면 CSRF 로 임의 주소에
  // 발송을 강제할 수 있다. Sec-Fetch-Site 는 브라우저가 위조 못 하므로, 주소창에
  // 직접 붙여넣거나(값 없음/"none") 같은 출처에서 온 요청("same-origin")만 통과시킨다.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "none" && fetchSite !== "same-origin") {
    return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  }

  const to = request.nextUrl.searchParams.get("to")?.trim() || user.email || "";
  if (!EMAIL_RE.test(to)) {
    return NextResponse.json({ error: "`to` is not a valid email address." }, { status: 400 });
  }

  const res = await sendEmail({
    to,
    subject: "Possion — notification test",
    text: "This is a test of Possion's chat notification email. Nothing is wrong.",
    html: "<p>This is a test of Possion&rsquo;s chat notification email. Nothing is wrong.</p>",
  });
  return NextResponse.json({
    ok: "ok" in res,
    configured,
    env,
    sent: "ok" in res,
    to,
    detail: "error" in res ? res.error : null,
  });
}
