import { requireUser } from "@/lib/auth";
import { Copyable } from "@/components/copyable";
import { SettingsForm } from "./settings-form";
import { AvatarUpload } from "./avatar-upload";
import { PasswordForm } from "./password-form";
import { ThemePicker } from "./theme-picker";
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
            <span className="label">ACCOUNT</span>
          </div>
          <div className="panel-body">
            <div className="field">
              <span className="label">Email</span>
              <div className="mono" style={{ color: "var(--text-1)", marginTop: 6 }}>
                {email}
              </div>
            </div>
            <div className="field">
              <span className="label">Access level</span>
              <div style={{ marginTop: 6 }}>
                {profile.role === "admin" ? (
                  <span className="badge badge-admin">admin</span>
                ) : (
                  <span className="badge">user</span>
                )}
              </div>
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
              Others need this ID to share files, documents or maps with you.
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
