/**
 * 서버에서 터진 오류를 실제 메시지로 로그에 남긴다.
 *
 * 프로덕션 빌드는 브라우저에 "An error occurred in the Server Components
 * render" 와 digest(예: 3290735100) 만 보낸다 — 민감한 내용이 새지 않게 하려는
 * 의도된 동작이지만, 그것만으로는 무엇이 왜 터졌는지 알 길이 없다. digest 는
 * 오류마다 정해지는 값이므로, 서버 쪽에서 **digest 와 실제 메시지를 한 줄에
 * 같이** 찍어 두면 사용자가 본 digest 로 원인을 바로 찾을 수 있다.
 *
 * Vercel 이라면 Deployments → 해당 배포 → Logs 에서 `[possion:error]` 로
 * 검색하면 된다.
 */

export async function register(): Promise<void> {
  // 지금은 초기화할 것이 없다. onRequestError 를 쓰려면 이 파일이 존재해야
  // 하므로 훅만 남겨 둔다.
}

type RequestInfo = { path?: string; method?: string; headers?: Record<string, string | undefined> };
type ErrorContext = { routerKind?: string; routePath?: string; renderSource?: string };

export function onRequestError(
  error: unknown,
  request: RequestInfo,
  context: ErrorContext
): void {
  const err = error as { message?: string; digest?: string; stack?: string };
  const parts = [
    `[possion:error]`,
    err?.digest ? `digest=${err.digest}` : "digest=-",
    `${request?.method ?? "?"} ${request?.path ?? "?"}`,
    context?.routePath ? `route=${context.routePath}` : "",
    context?.renderSource ? `source=${context.renderSource}` : "",
    `— ${err?.message ?? String(error)}`,
  ].filter(Boolean);

  console.error(parts.join(" "));
  if (err?.stack) console.error(err.stack);
}
