// API 응답이 JSON 이 아닐 때 사람이 읽을 수 있는 말이 나오는지 검증.
// 실행: node lib/fetch-json.test.mjs
//
// 이 파일이 있는 이유: 세션이 만료되면 미들웨어가 `/api/...` 를 `/login` 으로
// 307 시키고 fetch 는 리다이렉트를 따라가 **로그인 페이지 HTML** 을 받는다.
// 예전 코드는 그것을 그대로 res.json() 해서 "Unexpected token '<'" 을
// 사용자에게 보여 줬다. 그런 응답이 와도 원인을 말해 주는지 확인한다.
import assert from "node:assert";
import { fetchJson } from "./fetch-json.ts";

// 브라우저 전역 흉내 — fetchJson 은 window.location.origin 과 fetch 만 쓴다.
globalThis.window = { location: { origin: "https://app.example.com" } };

function reply({ url = "https://app.example.com/api/x", status = 200, type = "application/json", body = "" }) {
  return {
    url,
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => (k.toLowerCase() === "content-type" ? type : null) },
    text: async () => body,
  };
}

function stub(response) {
  globalThis.fetch = async () => {
    if (response instanceof Error) throw response;
    return response;
  };
}

// ---------------------------------------------------------------- 정상 응답
stub(reply({ body: JSON.stringify({ hello: "world" }) }));
{
  const res = await fetchJson("/api/x");
  assert.equal(res.ok, true);
  assert.deepEqual(res.data, { hello: "world" });
}

// 본문이 비어 있어도 터지지 않는다(204 등).
stub(reply({ status: 204, body: "" }));
{
  const res = await fetchJson("/api/x");
  assert.equal(res.ok, true);
  assert.equal(res.data, null);
}

// ---------------------------------------------------------------- 세션 만료
// 미들웨어가 로그인으로 튕긴 경우 — fetch 가 리다이렉트를 따라가 응답 URL 이
// /login 이 된다. 여기서 잡아야 한다.
stub(reply({ url: "https://app.example.com/login?redirect=%2Fapi%2Fx", type: "text/html", body: "<!doctype html>" }));
{
  const res = await fetchJson("/api/x");
  assert.equal(res.ok, false);
  assert.equal(res.error, "Your session expired — sign in again.");
  assert.equal(res.status, 401);
}

// 리다이렉트를 따라가지 않고 401 만 온 경우도 같은 말을 한다.
stub(reply({ status: 401, type: "text/plain", body: "Unauthorized" }));
{
  const res = await fetchJson("/api/x");
  assert.equal(res.ok, false);
  assert.equal(res.error, "Your session expired — sign in again.");
}

// ---------------------------------------------------------------- HTML 오류
// 게이트웨이/프록시가 HTML 오류 페이지를 준 경우 — 그 내용을 사용자에게
// 보여 주지 않고 상태 코드로 설명한다.
stub(reply({ status: 502, type: "text/html", body: "<html><body>Bad Gateway</body></html>" }));
{
  const res = await fetchJson("/api/x");
  assert.equal(res.ok, false);
  assert.equal(res.error, "The server returned an unexpected response (502).");
  assert.equal(res.status, 502);
  assert.ok(!res.error.includes("<"), "HTML 조각이 메시지에 새어 나오면 안 된다");
}

// ---------------------------------------------------------------- 깨진 JSON
stub(reply({ body: "{not json" }));
{
  const res = await fetchJson("/api/x");
  assert.equal(res.ok, false);
  assert.equal(res.error, "The server sent a malformed response (200).");
  assert.ok(!res.error.includes("Unexpected token"), "파서의 불평이 그대로 나가면 안 된다");
}

// ---------------------------------------------------------------- 서버 오류
// 서버가 JSON 으로 이유를 말해 주면 그 말을 그대로 쓴다.
stub(reply({ status: 503, body: JSON.stringify({ error: "No Gemini API key configured on the server." }) }));
{
  const res = await fetchJson("/api/x");
  assert.equal(res.ok, false);
  assert.equal(res.error, "No Gemini API key configured on the server.");
  assert.equal(res.status, 503);
}

// error 필드가 없거나 문자열이 아니면 상태 코드로 대체한다.
stub(reply({ status: 500, body: JSON.stringify({ error: { nested: true } }) }));
{
  const res = await fetchJson("/api/x");
  assert.equal(res.ok, false);
  assert.equal(res.error, "Request failed (500).");
}

// ---------------------------------------------------------------- 네트워크
stub(new Error("Failed to fetch"));
{
  const res = await fetchJson("/api/x");
  assert.equal(res.ok, false);
  assert.equal(res.error, "Could not reach the server. Check your connection.");
  assert.equal(res.status, 0);
}

// content-type 헤더가 아예 없는 응답에서도 터지지 않는다.
globalThis.fetch = async () => ({
  url: "https://app.example.com/api/x",
  status: 200,
  ok: true,
  headers: { get: () => null },
  text: async () => "plain",
});
{
  const res = await fetchJson("/api/x");
  assert.equal(res.ok, false);
  assert.ok(res.error.includes("unexpected response"));
}

console.log("fetch-json: all assertions passed");
