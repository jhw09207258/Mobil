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
import { NoZoom } from "./no-zoom";
import { UploadToasts } from "./uploads/upload-toasts";
import { ViewportFit } from "@/components/viewport-fit";
import { AgentToasts } from "./big-brother/agent-toasts";

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
            userId={userId}
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
          {/* 진행률 토스트 — 실제 업로드 상태는 React 트리 밖(upload-store)에
              있어 화면을 옮기거나 이 컴포넌트가 다시 마운트돼도 유지된다. */}
          <ViewportFit />
          <UploadToasts />
          <AgentToasts />
        </div>
      </WorkspaceProvider>
    </MobileNavProvider>
  );
}
