/**
 * 우리 API 라우트를 부르고 JSON 으로 읽는 공통 경로.
 *
 * 왜 필요한가 — `await res.json()` 을 그냥 쓰면 응답이 JSON 이 아닐 때
 * "Unexpected token '<'" 같은 말이 사용자에게 그대로 튀어나온다. 그리고 그
 * 상황은 드물지 않다.
 *
 *   * 세션이 만료되면 미들웨어가 `/api/...` 요청을 `/login` 으로 307 시키고,
 *     fetch 는 리다이렉트를 따라가 **로그인 페이지 HTML** 을 받는다.
 *   * 배포/프록시 장애 시 게이트웨이가 HTML 오류 페이지를 돌려준다.
 *
 * 두 경우 모두 진짜 원인은 "다시 로그인해야 한다" 또는 "서버가 잠깐 이상하다"
 * 인데, JSON 파서의 불평이 그것을 덮어 버린다. 여기서 한 번 걸러 사람이 읽을
 * 수 있는 말로 바꾼다.
 */

export type JsonResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

/** 로그인 화면으로 튕겼는지 — 응답 URL 이나 콘텐츠 타입으로 판별한다. */
function looksLikeLoginRedirect(res: Response): boolean {
  try {
    return new URL(res.url, window.location.origin).pathname === "/login";
  } catch {
    return false;
  }
}

export async function fetchJson<T>(
  input: string,
  init?: RequestInit
): Promise<JsonResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection.", status: 0 };
  }

  if (looksLikeLoginRedirect(res)) {
    return { ok: false, error: "Your session expired — sign in again.", status: 401 };
  }

  const contentType = res.headers.get("content-type") ?? "";
  const body = await res.text().catch(() => "");

  if (!contentType.includes("json")) {
    // 본문이 HTML 이면 그 내용을 사용자에게 보여 봐야 의미가 없다.
    return {
      ok: false,
      error:
        res.status === 401 || res.status === 403
          ? "Your session expired — sign in again."
          : `The server returned an unexpected response (${res.status}).`,
      status: res.status,
    };
  }

  let parsed: unknown;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    return { ok: false, error: `The server sent a malformed response (${res.status}).`, status: res.status };
  }

  if (!res.ok) {
    const message =
      (parsed as { error?: unknown } | null)?.error;
    return {
      ok: false,
      error: typeof message === "string" && message ? message : `Request failed (${res.status}).`,
      status: res.status,
    };
  }

  return { ok: true, data: parsed as T };
}
