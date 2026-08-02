import "./app.css";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "./header";
import { Sidebar } from "./sidebar";
import { Shortcuts } from "./shortcuts";
import { WorkspaceProvider } from "./workspace/workspace-context";
import { WorkspaceShell } from "./workspace/workspace-shell";
import { MobileNavProvider } from "./mobile-nav-context";
import { ReconnectTracker } from "./reconnect-tracker";
import { NoZoom } from "./no-zoom";
import { UploadToasts } from "./uploads/upload-toasts";
import { ViewportFit } from "@/components/viewport-fit";
import { ReminderHeartbeat } from "./push/reminder-heartbeat";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, email, profile, profileMissing } = await requireUser();

  // 팀 선택은 가입 시점의 절차라 관리자 승인보다 먼저 강제한다 — 승인을
  // 기다리는 동안에도 팀은 이미 고를 수 있어야 한다(0080). 팀이 삭제돼
  // active_team_id 가 사라진 드문 경우에도 여기로 다시 보낸다.
  //
  // 단, 프로필을 아예 못 읽은 경우(profileMissing)는 제외한다. 그때
  // active_team_id 는 "팀이 없다"가 아니라 "모른다"이고, 이미 팀에 속한
  // 사람을 팀 선택 화면으로 보내면 멀쩡한 팀이 있는데 새로 만들라고 권하는
  // 꼴이 된다. 아래 승인 검사가 대기 화면으로 보내 준다 — 임시 프로필이
  // approval_status 를 "pending" 으로 두는 것도 원래 그 뜻이다.
  if (!profile.active_team_id && !profileMissing) {
    redirect("/choose-team");
  }

  // 승인제: 관리자 승인 전(대기/거절)에는 앱 내 어떤 화면도 보여주지 않고
  // 대기 화면으로 보낸다. redeem_admin_code 가 승격과 동시에 승인도 강제하므로
  // role 은 별도로 검사할 필요가 없다.
  if (profile.approval_status !== "approved") {
    redirect("/pending-approval");
  }

  // active_team_id 는 위 가드를 지나면 거의 항상 있지만, 프로필을 못 읽은
  // 경우엔 null 인 채로 여기 올 수 있다(그땐 승인 검사가 이미 내보낸 뒤다).
  // 이름을 못 찾으면 헤더의 팀 전환기가 "Choose a team" 으로 뜬다.
  const supabase = await createClient();
  const { data: activeTeam } = profile.active_team_id
    ? await supabase.from("teams").select("name").eq("id", profile.active_team_id).single()
    : { data: null };

  return (
    <MobileNavProvider>
      {/* key={userId} — 같은 브라우저에서 다른 계정으로 로그인하면 워크스페이스
          provider 를 통째로 리마운트해 이전 사용자의 탭 상태가 남지 않게 한다. */}
      <WorkspaceProvider key={userId} userId={userId}>
        <div className="app">
          <NoZoom />
          <ReconnectTracker />
          <AppHeader
            userId={userId}
            displayName={profile.display_name ?? ""}
            email={email}
            avatarUrl={profile.avatar_url}
            activeTeamName={activeTeam?.name ?? null}
          />
          <div className="app-body">
            <Sidebar role={profile.role} />
            <main className="app-main">
              <WorkspaceShell>{children}</WorkspaceShell>
            </main>
          </div>
          <Shortcuts />
          {/* 진행률 토스트 — 실제 업로드 상태는 React 트리 밖(upload-store)에
              있어 화면을 옮기거나 이 컴포넌트가 다시 마운트돼도 유지된다. */}
          <ViewportFit />
          <UploadToasts />
          <ReminderHeartbeat />
        </div>
      </WorkspaceProvider>
    </MobileNavProvider>
  );
}
