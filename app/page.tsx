import { redirect } from "next/navigation";

// Middleware already sends unauthenticated visitors to /login and users
// without an organization to /onboarding, so anyone reaching here is ready
// for the app shell.
export default function RootPage() {
  redirect("/dashboard");
}
