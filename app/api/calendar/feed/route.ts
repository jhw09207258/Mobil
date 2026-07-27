import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildIcs, type IcsEvent } from "@/lib/ics";

/**
 * ICS 구독 피드 — Google Calendar 의 "URL 로 추가", Apple 캘린더의
 * "캘린더 구독" 에 그대로 넣는 주소다.
 *
 *   GET /api/calendar/feed?token=<64자리 hex>
 *
 * 이 경로만 로그인 없이 열린다. 캘린더 앱은 우리 세션 쿠키를 갖고 있지 않고,
 * OAuth 를 세우는 것은 이 기능의 무게를 한참 넘어선다. 대신 토큰 하나가 곧
 * 인증이므로 다음을 지킨다.
 *   * 토큰은 서버가 32바이트 난수로만 만든다(사용자가 정할 수 없다).
 *   * 토큰으로 볼 수 있는 것은 그 사람이 원래 볼 수 있는 일정뿐이고,
 *     쓰기는 어떤 경로로도 열리지 않는다.
 *   * 유출되면 설정에서 회전(rotate)해 이전 주소를 즉시 죽인다.
 */
export const dynamic = "force-dynamic";

const TOKEN_RE = /^[0-9a-f]{64}$/;

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!TOKEN_RE.test(token)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_calendar_feed", { p_token: token });

  if (error) {
    return NextResponse.json({ error: "Calendar feed is unavailable." }, { status: 503 });
  }
  // 토큰이 틀렸는지 일정이 없는지 구분해 주지 않는다 — 둘 다 빈 달력이다.
  const rows = data ?? [];

  const events: IcsEvent[] = rows.map((e) => ({
    // UID 는 구독 측에서 같은 일정을 알아보는 열쇠다. 안정적이어야 하므로 id 를 쓴다.
    uid: `${e.id}@possion`,
    title: e.title,
    description: e.description,
    location: e.location,
    url: e.conference_url,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    allDay: e.all_day,
    recurrence: e.recurrence,
    recurrenceUntil: e.recurrence_until,
    status: e.status,
    updatedAt: e.updated_at,
  }));

  const body = buildIcs(events, "Possion");

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="possion.ics"',
      // 구독 클라이언트가 한 시간 간격으로 다시 물어보게 한다.
      "Cache-Control": "private, max-age=0, must-revalidate",
      // 검색엔진/프록시에 남지 않게.
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
