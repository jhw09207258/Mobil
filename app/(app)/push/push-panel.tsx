"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getPushStatus,
  removePushSubscription,
  savePushSubscription,
  sendTestPush,
  setPushEnabled,
  type PushStatus,
} from "./actions";

/**
 * 알림 설정 — 이 기기에서 푸시를 켜고 끈다.
 *
 * 권한을 페이지 로드 때 묻지 않는다. 브라우저가 그런 요청을 영구 차단하는
 * 쪽으로 움직여 왔고, 무엇보다 맥락 없이 뜨는 권한 창은 대부분 거절당한다 —
 * 한 번 거절되면 되돌리기가 아주 번거롭다. 사용자가 여기서 직접 누를 때만 묻는다.
 */

type Support =
  | { state: "checking" }
  | { state: "unsupported"; reason: string }
  | { state: "ready"; permission: NotificationPermission };

/** VAPID 공개키(base64url) → Uint8Array. PushManager 가 요구하는 형식. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  // PushManager 는 SharedArrayBuffer 가 아닌 ArrayBuffer 뷰를 요구한다 —
  // 버퍼를 먼저 만들어 타입을 좁힌다.
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** ArrayBuffer → base64url. 구독 키를 서버로 보낼 때. */
function bufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const ua = userAgent;
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari"
    : "Browser";
  const os =
    /iPhone|iPad/.test(ua) ? "iOS"
    : /Android/.test(ua) ? "Android"
    : /Mac OS X/.test(ua) ? "macOS"
    : /Windows/.test(ua) ? "Windows"
    : /Linux/.test(ua) ? "Linux"
    : "";
  return os ? `${browser} on ${os}` : browser;
}

export function PushPanel() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [support, setSupport] = useState<Support>({ state: "checking" });
  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    getPushStatus().then(setStatus, () => setError("Could not load your notification settings."));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 이 브라우저가 무엇을 할 수 있는지 확인하고, 이미 구독돼 있으면 그 주소를 읽는다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window === "undefined") return;
      if (!("serviceWorker" in navigator)) {
        if (!cancelled) setSupport({ state: "unsupported", reason: "This browser has no service worker support." });
        return;
      }
      if (!("PushManager" in window) || !("Notification" in window)) {
        if (!cancelled) {
          setSupport({
            state: "unsupported",
            // iOS 는 홈 화면에 설치해야만 푸시가 열린다 — 가장 흔한 막힘이라 짚어 준다.
            reason:
              /iPhone|iPad/.test(navigator.userAgent)
                ? "On iPhone and iPad, add Possion to your Home Screen first — Safari only allows notifications for installed apps."
                : "This browser does not support push notifications.",
          });
        }
        return;
      }
      if (!cancelled) setSupport({ state: "ready", permission: Notification.permission });

      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const existing = await registration?.pushManager.getSubscription();
        if (!cancelled) setThisEndpoint(existing?.endpoint ?? null);
      } catch {
        /* 구독 조회 실패는 "아직 안 켬" 과 같게 다룬다. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enableHere = async () => {
    if (busy || !status?.publicKey) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const permission = await Notification.requestPermission();
      setSupport({ state: "ready", permission });
      if (permission !== "granted") {
        setError(
          permission === "denied"
            ? "This browser is blocking notifications for Possion. Allow them in the site settings, then try again."
            : "Notifications were not allowed."
        );
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;

      // 이미 구독이 있으면 재사용한다. 키가 바뀐 경우에는 해지하고 다시 만든다.
      let subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const current = bufferToBase64Url(subscription.options.applicationServerKey ?? null);
        if (current && current !== status.publicKey) {
          await subscription.unsubscribe();
          subscription = null;
        }
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(status.publicKey),
        });
      }

      const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const res = await savePushSubscription({
        endpoint: json.endpoint ?? subscription.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
        userAgent: navigator.userAgent,
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setThisEndpoint(subscription.endpoint);
      setNotice("This device will now get notifications even when Possion is closed.");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not turn on notifications here.");
    } finally {
      setBusy(false);
    }
  };

  const disableHere = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      const endpoint = subscription?.endpoint ?? thisEndpoint;
      if (subscription) await subscription.unsubscribe();
      if (endpoint) await removePushSubscription(endpoint);
      setThisEndpoint(null);
      setNotice("This device will no longer get notifications.");
      refresh();
    } catch {
      setError("Could not turn notifications off here.");
    } finally {
      setBusy(false);
    }
  };

  const removeDevice = async (endpoint: string) => {
    const res = await removePushSubscription(endpoint);
    if ("error" in res) setError(res.error);
    else {
      if (endpoint === thisEndpoint) setThisEndpoint(null);
      refresh();
    }
  };

  const toggleAccount = async (next: boolean) => {
    if (!status) return;
    setStatus({ ...status, enabled: next });
    const res = await setPushEnabled(next);
    if ("error" in res) {
      setStatus({ ...status, enabled: !next });
      setError(res.error);
    }
  };

  const test = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await sendTestPush();
    setBusy(false);
    if ("error" in res) setError(res.error);
    else setNotice(`Sent to ${res.sent} device${res.sent === 1 ? "" : "s"}.`);
  };

  if (!status) return <div className="empty">Loading…</div>;

  if (!status.available) {
    return (
      <div className="notice notice-info">
        Push notifications are not set up on this server yet, so new messages are announced by
        email only. An administrator can enable them by setting the VAPID keys — see the README.
      </div>
    );
  }

  const subscribedHere =
    !!thisEndpoint && status.devices.some((d) => d.endpoint === thisEndpoint);

  return (
    <>
      {error && <div className="notice notice-error">{error}</div>}
      {notice && <div className="notice notice-ok">{notice}</div>}

      <div className="field">
        <label className="row" style={{ gap: 10, alignItems: "flex-start" }}>
          <input
            type="checkbox"
            checked={status.enabled}
            disabled={busy}
            onChange={(e) => toggleAccount(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>
            <span style={{ color: "var(--text-1)" }}>Send me push notifications</span>
            <br />
            <span className="muted" style={{ fontSize: 12 }}>
              New chat messages, calendar invitations and event reminders. Arrives even when
              Possion is closed. Turning this off silences every device at once.
            </span>
          </span>
        </label>
      </div>

      {support.state === "unsupported" ? (
        <div className="notice notice-info">{support.reason}</div>
      ) : (
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {subscribedHere ? (
            <>
              <button className="btn btn-sm" onClick={disableHere} disabled={busy}>
                Turn off on this device
              </button>
              <button className="btn btn-sm" onClick={test} disabled={busy || !status.enabled}>
                Send a test
              </button>
            </>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={enableHere} disabled={busy}>
              {busy ? "Working…" : "Turn on for this device"}
            </button>
          )}
          {support.state === "ready" && support.permission === "denied" && (
            <span className="muted" style={{ fontSize: 12 }}>
              Blocked in your browser settings — allow notifications for this site first.
            </span>
          )}
        </div>
      )}

      <div className="field">
        <span className="label">DEVICES ({status.devices.length})</span>
        {status.devices.length === 0 ? (
          <span className="muted" style={{ fontSize: 12 }}>
            No device is set up yet. Until then, you will be told about new messages by email.
          </span>
        ) : (
          <div className="push-devices">
            {status.devices.map((d) => (
              <div key={d.id} className="push-device">
                <span className="push-device-name">
                  {deviceLabel(d.user_agent)}
                  {d.endpoint === thisEndpoint && <span className="badge badge-ok">This device</span>}
                </span>
                <span className="push-device-meta mono">
                  {d.last_used_at
                    ? `last used ${new Date(d.last_used_at).toLocaleDateString()}`
                    : `added ${new Date(d.created_at).toLocaleDateString()}`}
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => removeDevice(d.endpoint)}
                  disabled={busy}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{pushCss}</style>
    </>
  );
}

const pushCss = `
.push-devices { display: flex; flex-direction: column; gap: 6px; }
.push-device {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border-0);
  border-radius: var(--radius);
  background: var(--bg-1);
}
.push-device-name {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: var(--text-1);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.push-device-meta { font-size: 11px; color: var(--text-3); flex: none; }
@media (max-width: 640px) {
  .push-device-meta { display: none; }
}
`;
