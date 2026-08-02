/**
 * SLO 목표치 — 기능별 p99/p999 목표와, 표본을 얼마나 자주 남길지.
 *
 * 이 숫자들은 **잠정치**다. v1.6.4 에서 로컬로 재현한 서버측(DB) 백분위에
 * 배포 환경의 네트워크·PostgREST 왕복을 감안한 여유를 얹어 정했다 — 실제
 * 배포에서 잰 값이 아직 없었기 때문이다("SLO 목표치 설정 — 목표를 정하려면
 * 배포 환경의 실제 분포가 필요합니다" 라고 그때 적어 두었다). 지금 이
 * 마이그레이션(0073)과 lib/observability.ts 가 바로 그 실제 분포를 쌓는
 * 장치이므로, `/admin/observability` 에 데이터가 쌓이는 대로 이 값들을
 * 다시 보고 조정해야 한다 — 목표가 아니라 첫 추정치로 대하는 것이 맞다.
 *
 * measure() 의 서버측 실행시간은 Server Action 이 supabase.rpc(...) 를
 * **왕복하는 전체 시간**이다(v1.6.4 의 bench.sql 과 달리 PL/pgSQL 안에서만
 * 잰 것이 아니라, 여기서는 네트워크 + PostgREST + DB 를 다 포함한다) — 그래서
 * 목표치를 DB 전용 값보다 훨씬 넉넉하게 잡았다.
 *
 * sampleRate 는 계측 자체가 부하가 되지 않게 기능마다 다르게 둔다. 로그인·
 * 가입처럼 드물고 중요한 경로는 1(전수), 자주 불리는 읽기 경로는 낮춘다.
 *
 * ---- v1.6.21, 첫 운영 표본으로 배운 것 -------------------------------------
 * 위 예고대로 실제 분포를 처음 확인했고, 한 가지가 분명해졌다: **왕복 한 번의
 * 바닥값이 약 30ms 이고, 가벼운 읽기에서는 이것이 시간의 거의 전부다.**
 * 근거는 표본을 뜬 시점에 calendar_events 행이 5개, calendars 가 2개뿐이었다는
 * 것이다 — 그 상태에서도 calendar.upcoming 중앙값이 36.6ms 였으니, 로컬 서버측
 * 값(4.6ms)과의 차이는 질의가 아니라 앱↔DB 왕복(네트워크 + PostgREST)이다.
 *
 * 그래서 새 목표를 정할 때의 원칙:
 *   * 목표는 "로컬 값 + 여유"가 아니라 "왕복 바닥값(≈30ms) + 질의 비용 + 여유"
 *     로 잡는다. 로컬 값만 보고 정하면 바닥값을 다 써 버린 목표가 나온다.
 *   * 왕복 한 번짜리 가벼운 읽기끼리는 질의 비용 차이(4~8ms)보다 바닥값이
 *     훨씬 크므로, 서로 다른 목표를 주는 것이 오히려 부자연스럽다 — 같은
 *     예산(p99 60 / p999 150)으로 묶는다.
 *   * 목표를 못 지킬 때 먼저 물을 것은 "질의를 어떻게 더 빠르게"가 아니라
 *     "이 왕복을 없앨 수 있는가"다(같은 화면의 다른 조회와 Promise.all 로
 *     묶기 등). 실제로 대시보드에서 그렇게 왕복 하나를 없앴다.
 */
export type SloTarget = {
  /** 사람이 읽는 이름 — 관리자 화면에 그대로 쓴다. */
  label: string;
  /** 목표 p99 (ms). 이 아래면 "정상". */
  p99TargetMs: number;
  /** 목표 p999 (ms). */
  p999TargetMs: number;
  /** 0~1. 이 비율만큼만 실제로 표본을 남긴다. */
  sampleRate: number;
  /** 왜 이 숫자인지 — 관리자 화면 툴팁에도 쓴다. */
  note: string;
};

// `: Record<string, SloTarget>` 가 아니라 `satisfies` 인 이유 — 애노테이션을
// 붙이면 키 타입이 string 으로 넓어져 아래 SloFeature 가 사실상 string 이 되고,
// measure("clanedar.upcoming", …) 같은 오타가 타입 검사를 그냥 통과한다(그러고는
// 런타임에 목표치를 못 찾고, measure 가 실패를 삼켜 조용히 사라진다).
// satisfies 는 값의 형태는 똑같이 검사하면서 키는 리터럴로 남긴다.
export const SLO = {
  "auth.login": {
    label: "로그인",
    p99TargetMs: 800,
    p999TargetMs: 2000,
    sampleRate: 1,
    note: "GoTrue 왕복(비밀번호 해시 확인 포함)이 섞여 있어 순수 조회보다 느린 것이 정상. 이번 장애(reference 234203017)의 진입점이라 전수 기록한다.",
  },
  "auth.signup": {
    label: "회원가입",
    p99TargetMs: 1000,
    p999TargetMs: 2500,
    sampleRate: 1,
    note: "signUp 은 로그인보다 무겁다(계정 생성 + 트리거). 빈도가 낮아 전수 기록 비용이 작다.",
  },
  "calendar.month": {
    label: "캘린더 한 달 조회",
    p99TargetMs: 60,
    p999TargetMs: 150,
    sampleRate: 0.3,
    note: "v1.6.4 서버(DB)측 p99 7.7ms · p999 10.1ms(0071 최적화 후, 로컬 재현). 네트워크+PostgREST 여유를 얹었다.",
  },
  "calendar.upcoming": {
    label: "다가오는 일정(대시보드)",
    p99TargetMs: 60,
    p999TargetMs: 150,
    sampleRate: 0.3,
    note: "v1.6.21 재조정(40→60). 서버측 질의 자체는 로컬 p99 4.6ms 인데 운영 표본의 **중앙값이 36.6ms** 였다 — 그때 calendar_events 행이 5개뿐이었으니 차이는 전부 앱↔DB 왕복(≈30ms)이다. 40ms 목표는 그 바닥 위에 10ms 만 남겨 둔 셈이라 질의를 아무리 고쳐도 지킬 수 없었다. 왕복이 지배적이므로 '한 번 왕복하는 읽기'는 calendar.month 와 같은 예산을 준다.",
  },
  "search.ontology": {
    label: "통합 검색",
    p99TargetMs: 80,
    p999TargetMs: 200,
    sampleRate: 0.3,
    note: "v1.6.4 서버측 p99 5.9ms · p999 8.1ms(0072 최적화 후, 로컬 재현). 실제 검색어 분포는 시드 데이터보다 다양할 수 있어 여유를 더 뒀다.",
  },
  "sharing.cards": {
    label: "첨부 카드 조회",
    p99TargetMs: 60,
    p999TargetMs: 150,
    sampleRate: 0.2,
    note: "채팅·캘린더 곳곳에서 자주 불려 표본 비율을 낮췄다. v1.6.21 재조정(40→60) — calendar.upcoming 과 같은 이유로, 왕복 한 번짜리 읽기는 앱↔DB 왕복(≈30ms)이 시간을 지배해 40ms 로는 여유가 사실상 없다(운영 중앙값 32.5ms).",
  },
  "sharing.attachable": {
    label: "첨부 후보 검색",
    p99TargetMs: 80,
    p999TargetMs: 200,
    sampleRate: 0.2,
    note: "v1.6.4 감사 시점 기준 최적화 후 가장 느린 기능(로컬 p999 13.4ms) — 다음으로 손볼 후보.",
  },
} satisfies Record<string, SloTarget>;

export type SloFeature = keyof typeof SLO;
