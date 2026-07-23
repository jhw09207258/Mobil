import "./app.css";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { AppHeader } from "./header";
import { Sidebar } from "./sidebar";
import { Shortcuts } from "./shortcuts";
import { WorkspaceProvider } from "./workspace/workspace-context";
import { WorkspaceShell } from "./workspace/workspace-shell";
import { MobileNavProvider } from "./mobile-nav-context";
import { ReconnectTracker } from "./reconnect-tracker";
import { GlobalChat } from "./chat/global-chat";
import { NoZoom } from "./no-zoom";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, email, profile } = await requireUser();

  // 승인제: 관리자 승인 전(대기/거절)에는 앱 내 어떤 화면도 보여주지 않고
  // 대기 화면으로 보낸다. redeem_admin_code 가 승격과 동시에 승인도 강제하므로
  // role 은 별도로 검사할 필요가 없다.
  if (profile.approval_status !== "approved") {
    redirect("/pending-approval");
  }

  return (
    <MobileNavProvider>
      {/* key={userId} — 같은 브라우저에서 다른 계정으로 로그인하면 워크스페이스
          provider 를 통째로 리마운트해 이전 사용자의 탭 상태가 남지 않게 한다. */}
      <WorkspaceProvider key={userId} userId={userId}>
        <div className="app">
          <NoZoom />
          <ReconnectTracker />
          <AppHeader
            displayName={profile.display_name ?? ""}
            email={email}
            avatarUrl={profile.avatar_url}
          />
          <div className="app-body">
            <Sidebar role={profile.role} />
            <main className="app-main">
              <WorkspaceShell>{children}</WorkspaceShell>
            </main>
          </div>
          <Shortcuts />
          <GlobalChat
            selfId={userId}
            selfName={profile.display_name || email}
          />
        </div>
      </WorkspaceProvider>
    </MobileNavProvider>
  );
}
