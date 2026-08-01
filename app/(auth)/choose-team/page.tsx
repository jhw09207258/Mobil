import { redirect } from "next/navigation";
import "../auth.css";
import { requireUser } from "@/lib/auth";
import { ChooseTeamPanel } from "./choose-team-panel";

export const dynamic = "force-dynamic";

/**
 * 팀 선택 게이트 — profiles.active_team_id 가 없으면 여기로 온다(가입 직후
 * 최초 1회, 혹은 팀이 삭제돼 소속이 사라진 드문 경우). 관리자 승인 대기와는
 * 별개 절차라 승인 여부와 무관하게 먼저 통과해야 한다(app/(app)/layout.tsx
 * 참고 — 이 체크가 승인 체크보다 앞선다).
 */
export default async function ChooseTeamPage() {
  const { profile } = await requireUser();

  if (profile.active_team_id) {
    redirect("/dashboard");
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ maxWidth: 520 }}>
        <div className="auth-brand">
          <span className="brand-logo brand-logo-lg">possion</span>
        </div>
        <div className="auth-panel">
          <h1 className="auth-h">Choose a team</h1>
          <p className="auth-desc">
            Every workspace in Possion belongs to a team — repositories, chat
            and sharing all stay within one. Create your own, or find one to
            join.
          </p>
          <ChooseTeamPanel />
        </div>
      </div>
    </div>
  );
}
