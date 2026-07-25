import { redirect } from "next/navigation";
import "../auth.css";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function PendingApprovalPage() {
  const { profile } = await requireUser();

  if (profile.approval_status === "approved") {
    redirect("/dashboard");
  }

  const rejected = profile.approval_status === "rejected";

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-logo brand-logo-lg">Possion</span>
        </div>
        <div className="auth-panel">
          <h1 className="auth-h">{rejected ? "Access denied" : "Awaiting approval"}</h1>
          <p className="auth-desc">
            {rejected
              ? "An administrator has declined this account. If you believe this is a mistake, contact your administrator."
              : "Your account was created but hasn't been approved by an administrator yet. You'll be able to use Possion as soon as it's approved."}
          </p>
          <form action="/auth/signout" method="post">
            <button type="submit" className="btn btn-ghost" style={{ width: "100%" }}>
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
