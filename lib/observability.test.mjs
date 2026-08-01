// finally 블록이 성공한 try 의 반환값을 삼켜버리는 JS 시맨틱스를 고정해 둔다.
// v1.6.6 배포 직후 로그인이 100% 실패했던 원인이 정확히 이것이었다 —
// measure() 의 finally 안에서 after() 가 던지면(배포 환경에서만 재현),
// 로그인이 실제로 성공했어도 그 반환값이 통째로 사라지고 finally 의 오류가
// 대신 올라갔다. 실행: node lib/observability.test.mjs
import assert from "node:assert";
import test from "node:test";

// measure() 를 고치기 전 모양 — finally 안에서 위험한 일을 직접 한다.
async function measureBroken(fn, riskyFinallyWork) {
  try {
    return await fn();
  } finally {
    riskyFinallyWork(); // 이게 던지면 위 return 은 사라진다.
  }
}

// 고친 모양 — finally 안의 위험한 일을 자체 try/catch 로 다시 감싼다.
async function measureFixed(fn, riskyFinallyWork) {
  try {
    return await fn();
  } finally {
    try {
      riskyFinallyWork();
    } catch {
      // 계측 실패가 기능 실패가 되면 안 된다.
    }
  }
}

test("고치기 전: finally 에서 던지면 성공한 반환값이 사라진다(버그 재현)", async () => {
  const throwingInstrumentation = () => {
    throw new Error("instrumentation blew up");
  };
  await assert.rejects(
    () => measureBroken(async () => ({ ok: true, redirectTo: "/dashboard" }), throwingInstrumentation),
    /instrumentation blew up/,
    "실제 로그인 성공값 대신 계측 오류가 호출부로 올라가야 버그가 재현된 것이다"
  );
});

test("고친 뒤: finally 에서 던져도 성공한 반환값이 살아남는다", async () => {
  const throwingInstrumentation = () => {
    throw new Error("instrumentation blew up");
  };
  const result = await measureFixed(
    async () => ({ ok: true, redirectTo: "/dashboard" }),
    throwingInstrumentation
  );
  assert.deepEqual(result, { ok: true, redirectTo: "/dashboard" });
});

test("고친 뒤: fn() 자체가 던지면 그 오류는 그대로 올라간다(계측이 실패를 숨기면 안 된다)", async () => {
  await assert.rejects(
    () =>
      measureFixed(async () => {
        throw new Error("real login failure");
      }, () => {}),
    /real login failure/
  );
});

test("고친 뒤: fn() 이 던지고 계측도 던지면, fn() 의 오류가 우선한다", async () => {
  await assert.rejects(
    () =>
      measureFixed(
        async () => {
          throw new Error("real login failure");
        },
        () => {
          throw new Error("instrumentation blew up too");
        }
      ),
    /real login failure/,
    "두 오류가 겹치면 실제 기능 오류가 나와야 한다 — 계측 오류가 원인을 가려선 안 된다"
  );
});
