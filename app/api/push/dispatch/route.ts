import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { nextReminderAt } from "@/lib/recurrence";
import { pushConfigured, sendPush, type PushTarget } from "@/lib/push";

/**
 * 일정 알림 발송기 — "10분 뒤 회의" 를 실제로 울리는 곳.
 *
 * 채팅·초대 알림은 그 동작을 한 사람이 있으니 그 자리에서 보내면 되지만,
 * 일정 알림은 **아무도 아무것도 하지 않은 순간에** 울려야 한다. 그래서 밖에서
 * 주기적으로 두드려 줄 무언가가 필요하고, 이 라우트가 그 접점이다.
 *
 * 부를 수 있는 것 세 가지 — 하나만 있어도 동작하고, 여러 개여도 안전하다
 * (claim 이 원자적이라 같은 알림이 두 번 나가지 않는다).
 *   1. Vercel Cron   — vercel.json 의 crons 항목. 배포만 하면 켜진다.
 *   2. pg_cron+pg_net — DB 에서 직접 호출(README 참고). Supabase 만으로 완결.
 *   3. 열려 있는 앱 창 — 로그인한 사용자의 탭이 주기적으로 한 번씩 두드린다.
 *      아무 스케줄러도 없는 환경에서도 "누군가 앱을 보고 있는 동안"은 울린다.
 *
 * 인가는 두 겹이다.
 *   * 이 라우트를 부를 자격: CRON_SECRET 헤더 **또는** 로그인 세션.
 *   * DB 에서 남의 일정을 읽을 자격: NOTIFY_DISPATCH_TOKEN(관리자 콘솔에서 발급).
 *     Supabase 서비스 롤 키를 앱에 들이지 않기 위한 선택이다 — 그 키는 모든
 *     RLS 를 무시하므로 알림 하나 때문에 배포 환경에 심고 싶지 않다.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type DueRow = {
  event_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
  time_zone: string;
  recurrence: string | null;
  recurrence_until: string | null;
  reminder_minutes: number | null;
  reminder_at: string;
  exceptions: string[] | null;
  recipients: { user_id: string; endpoint: string; p256dh: string; auth: string }[] | null;
};

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}

async function handle(request: NextRequest) {
  const token = process.env.NOTIFY_DISPATCH_TOKEN;
  if (!token) {
    return NextResponse.json(
      { ok: false, reason: "NOTIFY_DISPATCH_TOKEN is not set — event reminders are off." },
      { status: 503 }
    );
  }
  if (!pushConfigured()) {
    return NextResponse.json(
      { ok: false, reason: "VAPID keys are not set — push notifications are off." },
      { status: 503 }
    );
  }

  const supabase = await createClient();

  // 부를 자격: cron 시크릿이 맞거나, 로그인한 사용자이거나.
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  const bySecret = !!secret && header === `Bearer ${secret}`;
  if (!bySecret) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("claim_due_event_reminders", {
    p_token: token,
    p_limit: 50,
  });
  if (error) {
    return NextResponse.json({ ok: false, reason: "claim failed" }, { status: 500 });
  }

  const rows = (data ?? []) as DueRow[];
  let sent = 0;
  let pruned = 0;

  for (const row of rows) {
    const targets = (row.recipients ?? []) as PushTarget[];

    if (targets.length > 0) {
      const start = new Date(row.starts_at);
      const lead = row.reminder_minutes ?? 0;
      const when = row.all_day
        ? "today"
        : start.toLocaleTimeString("en-US", {
            timeZone: row.time_zone || "UTC",
            hour: "numeric",
            minute: "2-digit",
          });
      const result = await sendPush(targets, {
        title: row.title,
        body:
          (lead === 0 ? "Starting now" : `Starts at ${when}`) +
          (row.location ? ` · ${row.location}` : ""),
        url: `/calendar?event=${row.event_id}`,
        tag: `event:${row.event_id}`,
      });
      sent += result.delivered.length;
      for (const endpoint of result.gone) {
        await supabase
          .rpc("prune_push_subscription_by_token", { p_token: token, p_endpoint: endpoint })
          .then(
            () => {
              pruned += 1;
            },
            () => {}
          );
      }
    }

    // 다음 알림을 다시 예약한다. 반복 전개는 여기(Node)에서만 할 수 있으므로
    // 발송기가 이 일까지 맡는다 — 이걸 빼먹으면 반복 일정은 딱 한 번만 울린다.
    const next = nextReminderAt(
      {
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        recurrence: row.recurrence,
        recurrenceUntil: row.recurrence_until,
        allDay: row.all_day,
        timeZone: row.time_zone,
        exceptions: row.exceptions ?? [],
        reminderMinutes: row.reminder_minutes,
      },
      new Date()
    );
    if (next) {
      await supabase
        .rpc("set_next_reminder_by_token", {
          p_token: token,
          p_event: row.event_id,
          p_at: next.toISOString(),
        })
        .then(
          () => {},
          () => {}
        );
    }
  }

  return NextResponse.json({ ok: true, due: rows.length, sent, pruned });
}
