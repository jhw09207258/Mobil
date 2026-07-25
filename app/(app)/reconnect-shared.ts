// (app)/loading.tsx 와 reconnect-tracker.tsx 가 공유하는 상수. 민감한 값이
// 아니라 "마지막으로 화면이 정상적으로 떴던 시각" 힌트일 뿐이라 클라이언트가
// 읽고 쓸 수 있는 일반 쿠키로 충분하다.
export const LAST_SEEN_COOKIE = "possion_last_seen";
// 이보다 오래 전 활동이면 "오랜만의 접속"으로 보고 Reconnecting… 을 보여준다.
export const RECONNECT_THRESHOLD_MS = 10 * 60 * 1000; // 10분
