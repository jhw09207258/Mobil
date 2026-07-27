"use server";

import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser as requireUser } from "@/lib/auth";
import { pushConfigured, sendPush, vapidPublicKey } from "@/lib/push";

/**
 * 브라우저 푸시 구독의 등록/해지.
 *
 * 구독 정보는 "그 사람에게 알림을 보낼 수 있는 열쇠" 라서 RLS 로 본인만 만질
 * 수 있고(0068), 서버 액션도 항상 로그인한 본인 것만 다룬다.
 */

export type PushDevice = {
  id: string;
  endpoint: string;
  user_agent: string | null;
  created_at: string;
  last_used_at: string | null;
};

export type PushStatus = {
  /** 서버에 VAPID 키가 설정돼 있는가. 없으면 이 기능 자체가 꺼진 것이다. */
  available: boolean;
  publicKey: string | null;
  /** 프로필의 알림 스위치. 브라우저 권한과는 별개다. */
  enabled: boolean;
  devices: PushDevice[];
};

export async function getPushStatus(): Promise<PushStatus> {
  const { userId, profile } = await requireUser();
  if (!pushConfigured()) {
    return { available: false, publicKey: null, enabled: profile.push_notifications, devices: [] };
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, user_agent, created_at, last_used_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return {
    available: true,
    publicKey: vapidPublicKey(),
    enabled: profile.push_notifications,
    devices: data ?? [],
  };
}

export async function savePushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}): Promise<{ ok: true } | { error: string }> {
  const { userId } = await requireUser();
  if (!input.endpoint || !input.p256dh || !input.auth) {
    return { error: "That subscription is incomplete." };
  }
  if (input.endpoint.length > 2000) return { error: "That subscription looks wrong." };

  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      user_agent: input.userAgent?.slice(0, 300) ?? null,
      failure_count: 0,
    },
    { onConflict: "endpoint" }
  );
  if (error) return { error: "Could not register this device for notifications." };
  return { ok: true };
}

export async function removePushSubscription(
  endpoint: string
): Promise<{ ok: true } | { error: string }> {
  const { userId } = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", userId)
    .eq("endpoint", endpoint);
  if (error) return { error: "Could not remove this device." };
  return { ok: true };
}

export async function setPushEnabled(
  enabled: boolean
): Promise<{ ok: true } | { error: string }> {
  const { userId } = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ push_notifications: enabled })
    .eq("id", userId);
  if (error) return { error: "Could not save that setting." };
  return { ok: true };
}

/** 설정 화면의 "테스트 알림" — 지금 이 사람의 모든 기기로 한 번. */
export async function sendTestPush(): Promise<{ ok: true; sent: number } | { error: string }> {
  const { userId, profile, email } = await requireUser();
  if (!pushConfigured()) return { error: "Push notifications are not configured on the server." };

  const supabase = await createClient();
  const { data } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (!data?.length) return { error: "This browser is not subscribed yet." };

  const result = await sendPush(
    data.map((d) => ({ user_id: userId, ...d })),
    {
      title: "Possion",
      body: `Notifications are working, ${profile.display_name || email.split("@")[0]}.`,
      url: "/settings",
      tag: "possion-test",
    }
  );

  // 죽은 구독은 그 자리에서 치운다 — 본인 것이므로 RLS 로 지울 수 있다.
  for (const endpoint of result.gone) {
    await supabase.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint);
  }

  if (result.delivered.length === 0) {
    return { error: "Could not deliver to any of your devices — try turning notifications off and on." };
  }
  return { ok: true, sent: result.delivered.length };
}
