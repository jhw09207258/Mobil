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

  // ── 왜 순차 for 를 버렸는가 ────────────────────────────────────────────────
  // 전에는 회수한 알림을 for + await 로 하나씩 처리했다. 알림 하나가
  // (푸시 발송 → 죽은 구독 정리 → 다음 예약) 을 다 끝내야 다음 알림이 시작된다.
  // 그런데 푸시 발송은 외부 서비스(FCM/APNs/Mozilla) 호출이라 한 건이 몇 초씩
  // 걸리는 일이 드물지 않다 — 그 한 건 뒤에 **나머지 49건이 전부 줄을 선다.**
  // 09:00 시작 회의 알림이 남의 느린 엔드포인트 때문에 09:03 에 가는 식이고,
  // 이것이 이 시스템에서 가장 뚜렷한 head-of-line blocking 이었다.
  //
  // 알림끼리는 서로 독립적이므로 동시에 처리한다. 다만 무제한 병렬은 곤란하다
  // — 50건을 한꺼번에 열면 서버리스 인스턴스의 소켓과 메모리를 한 번에 쓰고,
  // 푸시 서비스 쪽 레이트리밋에도 걸린다. 그래서 상한을 둔 동시 실행으로 간다.
  const CONCURRENCY = 8;
  // 위의 !token 가드로 좁혀진 타입은 중첩 함수 안까지 따라오지 않는다.
  const dispatchToken: string = token;

  // 바깥 handle(request) 와 이름이 겹치지 않게 한다 — 겹치면 읽는 사람이
  // 어느 쪽이 불리는지 매번 되짚어야 한다.
  async function dispatchOne(row: DueRow) {
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
      // 죽은 구독 정리도 서로 독립적이다 — 한 건씩 기다릴 이유가 없다.
      await Promise.all(
        result.gone.map((endpoint) =>
          supabase
            .rpc("prune_push_subscription_by_token", { p_token: dispatchToken, p_endpoint: endpoint })
            .then(
              () => {
                pruned += 1;
              },
              () => {}
            )
        )
      );
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
          p_token: dispatchToken,
          p_event: row.event_id,
          p_at: next.toISOString(),
        })
        .then(
          () => {},
          () => {}
        );
    }
  }

  // 상한을 둔 동시 실행 — 작업자 CONCURRENCY 명이 같은 큐에서 하나씩 집어 간다.
  // 한 건이 느려도 그 작업자만 붙잡히고 나머지는 계속 흘러간다.
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, rows.length) }, async () => {
      while (cursor < rows.length) {
        const row = rows[cursor++];
        // 한 건이 던져도 나머지 발송을 멈추지 않는다 — 알림은 서로 남남이다.
        try {
          await dispatchOne(row);
        } catch (e) {
          console.error(
            `[push:dispatch] event ${row.event_id} failed:`,
            e instanceof Error ? e.message : e
          );
        }
      }
    })
  );

  return NextResponse.json({ ok: true, due: rows.length, sent, pruned });
}
