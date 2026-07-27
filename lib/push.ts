import "server-only";
import webpush, { type PushSubscription as WebPushSubscription } from "web-push";

/**
 * 웹 푸시 발송 — 앱을 닫아 두어도 도착하는 알림.
 *
 * 이메일과 나눠 쓰는 방식은 이렇다. 푸시가 성공한 사람에게는 메일을 보내지
 * 않고, 푸시를 구독하지 않았거나 발송이 실패한 사람에게만 메일이 나간다
 * (0068 의 claim 함수들이 그 명단을 만든다).
 *
 * VAPID 키가 없으면 조용히 꺼진다 — 알림이 안 나갔다고 메시지 전송 자체가
 * 실패하면 안 된다. 키 생성:
 *   node -e "console.log(require('web-push').generateVAPIDKeys())"
 */

export type PushTarget = {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushPayload = {
  title: string;
  body: string;
  /** 알림을 눌렀을 때 열 앱 내부 경로. */
  url?: string;
  /** 같은 tag 의 알림은 덮어쓴다 — 한 대화의 연속 메시지가 쌓이지 않게. */
  tag?: string;
  /** 조용히(소리·진동 없이) 갱신만 할 때. */
  renotify?: boolean;
};

export function pushConfigured(): boolean {
  return !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
}

/** 브라우저가 구독할 때 필요한 공개키. 비밀이 아니다. */
export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  // subject 는 푸시 서비스가 문제 발생 시 연락할 곳이다. mailto: 또는 https:.
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export type PushOutcome = {
  /** 실제로 도착이 접수된 사용자 — 이 사람들에게는 메일을 보내지 않는다. */
  delivered: string[];
  /** 푸시 서비스가 "없는 구독" 이라고 답한 endpoint — 지워야 한다. */
  gone: string[];
  /** 살아 있음이 확인된 endpoint. */
  alive: string[];
};

/**
 * 여러 구독에 같은 알림을 보낸다. 하나가 실패해도 나머지는 계속 간다.
 *
 * 404/410 은 "그 구독은 영영 없다"는 뜻이라 지워야 하고, 그 밖의 실패(일시적
 * 장애, 429 등)는 구독을 남겨 둔 채 넘어간다 — 잠깐의 장애로 사용자의 알림을
 * 영구히 끊으면 안 된다.
 */
export async function sendPush(
  targets: PushTarget[],
  payload: PushPayload
): Promise<PushOutcome> {
  const out: PushOutcome = { delivered: [], gone: [], alive: [] };
  if (targets.length === 0 || !ensureConfigured()) return out;

  const body = JSON.stringify(payload);

  await Promise.all(
    targets.map(async (t) => {
      const subscription: WebPushSubscription = {
        endpoint: t.endpoint,
        keys: { p256dh: t.p256dh, auth: t.auth },
      };
      try {
        await webpush.sendNotification(subscription, body, {
          TTL: 60 * 60 * 24, // 하루 안에 못 전하면 버린다
          urgency: "high",
        });
        out.delivered.push(t.user_id);
        out.alive.push(t.endpoint);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          out.gone.push(t.endpoint);
        } else {
          console.error(
            `[push] ${t.endpoint.slice(0, 48)}… failed: ${status ?? ""} ${
              e instanceof Error ? e.message : "unknown"
            }`
          );
        }
      }
    })
  );

  return out;
}
