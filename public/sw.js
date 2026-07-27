/* ==========================================================================
   Possion 서비스 워커 — 웹 푸시 수신 전용.
   --------------------------------------------------------------------------
   오프라인 캐싱은 **일부러 하지 않는다**. 이 앱의 화면은 거의 전부 서버에서
   권한을 확인해 그리는 것이라(문서·파일·채팅), 캐시에 남은 화면을 보여 주는
   것은 "권한이 회수된 자료를 계속 보여 주는" 일이 되기 쉽다. 서비스 워커는
   알림만 받는다.

   버전을 올리면 브라우저가 새 파일로 교체한다.
   ========================================================================== */

const VERSION = "possion-sw-1";

self.addEventListener("install", (event) => {
  // 새 워커가 곧바로 대기 상태를 벗어나게 한다 — 알림만 하는 워커라
  // 이전 버전과 공존시킬 이유가 없다.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // 형식이 깨진 페이로드라도 알림 자체는 띄운다 — 뭔가 왔다는 사실이 중요하다.
    data = { title: "Possion", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Possion";
  const options = {
    body: data.body || "",
    icon: "/android-icon-192x192.png",
    badge: "/android-icon-96x96.png",
    // 같은 tag 는 덮어쓴다 — 한 대화의 연속 메시지가 알림 센터에 쌓이지 않게.
    tag: data.tag || "possion",
    renotify: data.renotify !== false,
    timestamp: Date.now(),
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // 이미 열려 있는 창이 있으면 새 창을 만들지 않고 그 창을 옮긴다.
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(target);
            } catch {
              /* 다른 오리진 등으로 이동이 막히면 포커스만 준다. */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })()
  );
});

// 구독이 만료돼 브라우저가 새로 발급하면, 서버에 갱신을 알려야 한다.
// 열려 있는 창이 없을 수도 있으므로 서버 엔드포인트로 직접 보낸다.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const applicationServerKey = event.oldSubscription
        ? event.oldSubscription.options.applicationServerKey
        : null;
      if (!applicationServerKey) return;
      try {
        const fresh = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
        await fetch("/api/push/resubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            old: event.oldSubscription ? event.oldSubscription.endpoint : null,
            subscription: fresh.toJSON(),
          }),
        });
      } catch {
        /* 다음에 앱을 열 때 클라이언트가 다시 구독한다. */
      }
    })()
  );
});

// 개발 중 어떤 버전이 도는지 콘솔에서 확인할 수 있게.
self.addEventListener("message", (event) => {
  if (event.data === "version" && event.source) {
    event.source.postMessage({ version: VERSION });
  }
});
