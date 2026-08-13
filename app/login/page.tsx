import { Suspense } from "react";
import Link from "next/link";
import { LoginForm } from "./LoginForm";
import { SkeletonRows } from "@/components/states";

export const metadata = { title: "Sign in · Recruitment OS" };

export default function LoginPage() {
  return (
    <div className="auth-layout">
      <div className="auth-card">
        <div className="card">
          <h1 className="title is-4">Sign in</h1>
          <p className="subtitle is-6 has-text-secondary">
            Welcome back to your recruitment workspace.
          </p>

          <Suspense fallback={<SkeletonRows rows={3} />}>
            <LoginForm />
          </Suspense>

          <p className="has-text-secondary mt-4" style={{ fontSize: 13 }}>
            Don&apos;t have a workspace yet? <Link href="/signup">Create one</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
