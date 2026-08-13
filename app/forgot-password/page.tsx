import Link from "next/link";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata = { title: "Reset your password · Recruitment OS" };

export default function ForgotPasswordPage() {
  return (
    <div className="auth-layout">
      <div className="auth-card">
        <div className="card">
          <h1 className="title is-4">Reset your password</h1>
          <p className="subtitle is-6 has-text-secondary">
            We&apos;ll email you a link to choose a new one.
          </p>
          <ForgotPasswordForm />
          <p className="has-text-secondary mt-4" style={{ fontSize: 13 }}>
            <Link href="/login">Back to sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
