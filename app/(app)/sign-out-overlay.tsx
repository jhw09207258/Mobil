"use client";

// 로그아웃 모션 — 검정 화면이 페이드인되고, 그 위로 흰 파동이 한 번 퍼졌다
// 사라진다. 타이밍은 header.tsx 의 handleSignOut 이 이 CSS 애니메이션
// 길이(0.3s + 0.6s = 0.9s)에 맞춰 실제 로그아웃 처리를 기다린다.
export function SignOutOverlay() {
  return (
    <div className="signout-overlay">
      <div className="signout-ripple" />
    </div>
  );
}
