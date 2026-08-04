import { requireUser } from "@/lib/auth";
import { Copyable } from "@/components/copyable";
import { SettingsForm } from "./settings-form";
import { AvatarUpload } from "./avatar-upload";
import { PasswordForm } from "./password-form";
import { ThemePicker } from "./theme-picker";
import { NotificationToggle } from "./notification-toggle";
import { PushPanel } from "../push/push-panel";
import { ConnectedSystems } from "../dashboard/connected-systems";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { userId, email, profile } = await requireUser();
  const name = profile.display_name || email.split("@")[0];
  const initial = (name || "?").charAt(0).toUpperCase();

  return (
    <>
      <div className="content">
        <div className="page-head">
          <div>
            <h1 className="page-h">Settings</h1>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-header">
            <span className="label">PROFILE</span>
          </div>
          <div className="panel-body">
            <AvatarUpload userId={userId} initialUrl={profile.avatar_url} initial={initial} />
            <SettingsForm
              initialName={profile.display_name ?? ""}
              initialGender={profile.gender ?? ""}
              initialBio={profile.bio ?? ""}
              initialAge={profile.age}
              initialAddress={profile.address ?? ""}
              initialPhone={profile.phone ?? ""}
              initialAgePublic={profile.age_public}
              initialAddressPublic={profile.address_public}
              initialPhonePublic={profile.phone_public}
            />
          </div>
        </div>

        <ThemePicker />

        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-header">
            <span className="label">NOTIFICATIONS</span>
          </div>
          <div className="panel-body">
            <PushPanel />
            <div className="settings-sep" />
            <NotificationToggle initial={profile.email_chat_notifications ?? true} />
          </div>
        </div>

        {/* 계정 정보는 "이름 : 값" 짝이 전부라, 항목마다 칸을 새로 만드는 대신
            애플 설정앱처럼 한 상자에 담고 얇은 선으로만 나눈다. */}
        <div style={{ marginBottom: 24 }}>
          <span className="card-group-title">Account</span>
          <div className="card-group">
            <div className="card-row">
              <span className="card-row-label">Email</span>
              <span className="card-row-value mono">{email}</span>
            </div>
            <div className="card-row">
              <span className="card-row-label">Access level</span>
              <span className="card-row-value">
                {profile.role === "admin" ? (
                  <span className="badge badge-admin">admin</span>
                ) : (
                  <span className="badge">user</span>
                )}
              </span>
            </div>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-header">
            <span className="label">SECURITY</span>
          </div>
          <div className="panel-body">
            <PasswordForm />
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-header">
            <span className="label">MY SHARE ID</span>
          </div>
          <div className="panel-body">
            <p className="page-sub" style={{ margin: "0 0 12px" }}>
              Teammates need this ID to share files, documents or maps with you — sharing only works within the same team.
            </p>
            <Copyable value={userId} />
          </div>
        </div>

        <ConnectedSystems />

        <div className="acct-license" style={{ marginTop: 24, border: "none", padding: 0 }}>
          <div className="acct-license-title">Possion 1.0</div>
          <div className="acct-license-line">Developed by Haewon Jeong</div>
          <div className="acct-license-line">Apache License 2.0</div>
        </div>
      </div>
    </>
  );
}
