import Link from "next/link";
import { SignupForm } from "./SignupForm";
import { Logo } from "@/components/Logo";

export const metadata = { title: "Create your workspace" };

export default function SignupPage() {
  return (
    <div className="auth-layout">
      <div className="auth-card">
        <div className="auth-brand">
          <Logo variant="full" height={56} priority />
        </div>

        <div className="card">
          <h1 className="title is-4">Create your workspace</h1>
          <p className="subtitle is-6 has-text-secondary">
            You&apos;ll become the Owner and can invite your team next.
          </p>

          <SignupForm />

          <p className="has-text-secondary mt-4" style={{ fontSize: 13 }}>
            Already have an account? <Link href="/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
