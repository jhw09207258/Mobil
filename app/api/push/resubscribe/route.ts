import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * 브라우저가 구독을 갱신했을 때(pushsubscriptionchange) 서비스 워커가 부른다.
 *
 * 이 요청은 앱 창 없이 서비스 워커에서 나가지만 같은 오리진의 fetch 라
 * 세션 쿠키가 함께 간다 — 그래서 평범한 인증으로 본인 것만 갱신한다.
 * 서버가 못 따라가면 그 기기의 알림이 조용히 끊기므로, 실패해도 워커가
 * 다음 기회에 다시 시도할 수 있게 상태 코드로만 알린다.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authorised." }, { status: 401 });

  let payload: {
    old?: string | null;
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const sub = payload.subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: "Incomplete subscription." }, { status: 400 });
  }

  if (payload.old) {
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("endpoint", payload.old);
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      failure_count: 0,
    },
    { onConflict: "endpoint" }
  );
  if (error) return NextResponse.json({ error: "Could not save." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
