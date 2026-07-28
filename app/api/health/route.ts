import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * 배포 환경 진단 — "로컬에서는 되는데 배포에서만 깨진다" 를 끝내기 위한 창.
 *
 *   GET /api/health
 *
 * 왜 필요한가. 프로덕션 빌드는 서버 오류의 실제 메시지를 감추고 digest 만
 * 보낸다. 그래서 "digest 3290735100" 같은 보고를 받으면 원인을 좁힐 단서가
 * 없다 — 환경 변수가 빠졌는지, 라이브러리가 로드에 실패했는지, DB 가 안
 * 잡히는지, 마이그레이션이 덜 돌았는지 구분할 방법이 없다. 이 엔드포인트는
 * 그 네 가지를 한 번에 답한다.
 *
 * 로그인 없이 열려 있어야 한다 — 로그인 자체가 깨졌을 때 봐야 하는 화면이기
 * 때문이다. 그래서 **값은 절대 싣지 않는다.** 설정됐는지(true/false)와,
 * 그 결과 어떤 기능이 켜지는지만 말한다. 앞 몇 글자조차 내보내지 않는다.
 */
export const dynamic = "force-dynamic";

const present = (name: string) => !!process.env[name];

export async function GET() {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: present("NEXT_PUBLIC_SUPABASE_URL"),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: present("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    VAPID_PUBLIC_KEY: present("VAPID_PUBLIC_KEY"),
    VAPID_PRIVATE_KEY: present("VAPID_PRIVATE_KEY"),
    NOTIFY_DISPATCH_TOKEN: present("NOTIFY_DISPATCH_TOKEN"),
    RESEND_API_KEY: present("RESEND_API_KEY"),
    EMAIL_FROM: present("EMAIL_FROM"),
  };

  // web-push 는 서버 전용 CommonJS 라 번들/런타임 조합에 따라 로드에 실패할 수
  // 있다. 실패해도 앱이 죽지 않도록 동적 import 로 감싸 두었는데(lib/push.ts),
  // 그래서 더더욱 "지금 로드되는가" 를 밖에서 확인할 수 있어야 한다.
  let webPushLoads = false;
  let webPushError: string | null = null;
  try {
    await import("web-push");
    webPushLoads = true;
  } catch (e) {
    webPushError = e instanceof Error ? e.message : "unknown";
  }

  // DB 왕복 한 번 — 연결과 스키마를 동시에 확인한다. 결과 자체는 쓰지 않고
  // "오류가 났는지" 만 본다. 인증이 없으므로 RLS 가 어차피 아무것도 안 준다.
  // 마이그레이션 상태는 3값이다 — 적용됨 / 안 됨 / **아직 모름**. DB 에 닿지도
  // 못했으면 "모름" 이라고 말해야 한다. 예전엔 "42883 이 아니면 적용됨" 으로 적어
  // 서, 연결 실패(코드가 42883 이 아니다)까지 "적용됨" 으로 보고했다. 배포가
  // 깨졌을 때 이 화면을 보는 사람이 마이그레이션을 후보에서 지워 버리게 된다 —
  // 이 엔드포인트가 막으려던 바로 그 오진이다.
  const db: {
    reachable: boolean;
    error: string | null;
    migrations: Record<string, boolean | "unknown">;
  } = { reachable: false, error: null, migrations: {} };

  if (env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    try {
      const supabase = await createClient();
      // anon 으로 부를 수 있고 부작용이 없는 함수 하나로 왕복을 확인한다.
      // 토큰이 틀리면 빈 목록이 오는 것이 정상 동작이다(0067).
      const { error } = await supabase.rpc("get_calendar_feed", { p_token: "healthcheck" });
      if (!error) {
        db.reachable = true;
        db.migrations["0067_calendar_integrations"] = true;
      } else if (error.code === "42883") {
        // 함수가 없다 = 서버에는 닿았고, 스키마만 뒤처져 있다.
        db.reachable = true;
        db.error = "missing-function";
        db.migrations["0067_calendar_integrations"] = false;
      } else {
        db.error = error.code || "error";
        db.migrations["0067_calendar_integrations"] = "unknown";
      }
    } catch (e) {
      db.error = e instanceof Error ? e.message.slice(0, 120) : "unknown";
      db.migrations["0067_calendar_integrations"] = "unknown";
    }
  } else {
    db.error = "missing-env";
    db.migrations["0067_calendar_integrations"] = "unknown";
  }

  // 스키마가 뒤처져 있으면 로그인은 되어도 건강한 배포가 아니다. reachable 과
  // 따로 두어야 "닿기는 하는데 마이그레이션이 덜 돌았다" 를 한눈에 구분한다.
  const schemaCurrent = Object.values(db.migrations).every((v) => v === true);

  const features = {
    // 로그인·앱 전체가 이것 없이는 동작하지 않는다.
    core: env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY && db.reachable,
    schema: schemaCurrent,
    webPush: env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && webPushLoads,
    eventReminders:
      env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && webPushLoads && env.NOTIFY_DISPATCH_TOKEN,
    emailFallback: env.RESEND_API_KEY && env.EMAIL_FROM,
  };

  return NextResponse.json(
    {
      ok: features.core && features.schema,
      runtime: { node: process.version, env: process.env.VERCEL_ENV ?? "self-hosted" },
      env,
      webPush: { loads: webPushLoads, error: webPushError },
      db,
      features,
      note: "Values are never included — only whether each setting is present.",
    },
    { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } }
  );
}
