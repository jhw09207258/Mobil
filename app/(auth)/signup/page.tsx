import Link from "next/link";
import "../auth.css";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-logo brand-logo-lg">Possion</span>
        </div>
        <div className="auth-panel">
          <h1 className="auth-h">Sign up</h1>
          <p className="auth-desc">
            Create a new storage account with email and password.
          </p>
          <SignupForm />
        </div>
        <div className="auth-foot">
          Already have an account? <Link href="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
