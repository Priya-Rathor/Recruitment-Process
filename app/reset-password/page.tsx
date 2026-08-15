import { ResetPasswordForm } from "./ResetPasswordForm";
import { Logo } from "@/components/Logo";

export const metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <div className="auth-layout">
      <div className="auth-card">
        <div className="auth-brand">
          <Logo variant="full" height={56} priority />
        </div>

        <div className="card">
          <h1 className="title is-4">Choose a new password</h1>
          <p className="subtitle is-6 has-text-secondary">
            You&apos;ll stay signed in on this device.
          </p>
          <ResetPasswordForm />
        </div>
      </div>
    </div>
  );
}
