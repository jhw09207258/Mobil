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
    p99TargetMs: 40,
    p999TargetMs: 100,
    sampleRate: 0.3,
    note: "v1.6.4 서버측 p99 4.6ms · p999 5.3ms(로컬 재현). 대시보드를 열 때마다 불린다.",
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
    p99TargetMs: 40,
    p999TargetMs: 100,
    sampleRate: 0.2,
    note: "채팅·캘린더 곳곳에서 자주 불려 표본 비율을 낮췄다.",
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
