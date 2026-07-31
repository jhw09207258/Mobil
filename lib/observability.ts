import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SLO, type SloFeature } from "@/lib/slo";

/**
 * 기능 하나의 서버측 실행시간을 재고, 표본으로 남긴다.
 *
 * 두 가지를 한다.
 *   1) 매 호출마다 `[possion:perf]` 한 줄을 로그에 남긴다(instrumentation.ts
 *      의 `[possion:error]` 와 같은 convention — Vercel Logs 에서 그대로
 *      검색된다). 표본 기록 여부와 무관하게 항상 남는다 — 로그는 공짜다.
 *   2) `SLO[feature].sampleRate` 확률로만 `perf_samples` 에 실제로 쓴다.
 *      계측 자체가 부하가 되면 안 되므로 매 호출을 다 쓰지 않는다. 쓰기는
 *      Next 의 `after()` 로 **응답을 보낸 뒤에** 붙는다 — files/actions.ts 의
 *      감사 로그 기록과 같은 자리다. 실패해도 무시한다: 계측이 실패했다고
 *      기능이 실패하면 안 된다.
 *
 * `fn()` 이 던지면 그 실패까지 포함해서 시간을 재고(실패한 요청의 지연도
 * 알아야 한다) 그대로 다시 던진다 — 이 함수는 시간만 관찰할 뿐 오류를
 * 삼키지 않는다.
 */
export async function measure<T>(
  supabase: SupabaseClient,
  feature: SloFeature,
  fn: () => Promise<T>
): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    const ms = performance.now() - t0;
    console.log(`[possion:perf] feature=${feature} ms=${ms.toFixed(1)}`);

    if (Math.random() < SLO[feature].sampleRate) {
      // after() 는 진짜 Promise<void> 를 요구하는데 supabase.rpc(...) 는
      // thenable(PostgrestFilterBuilder) 이라 타입이 맞지 않는다. async 화살표로
      // 감싸 진짜 Promise 로 만든다.
      after(async () => {
        await supabase
          .rpc("record_perf_sample", { p_feature: feature, p_ms: ms })
          .then(
            () => {},
            () => {}
          );
      });
    }
  }
}
