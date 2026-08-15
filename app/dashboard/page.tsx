import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/states";
import { requireMembershipOrRedirect } from "@/lib/tenant";
import { formatDayInZone, resolveTimeZone } from "@/lib/time";
import { availableMetrics, getDashboardData, scopeForRole } from "@/lib/dashboard/metrics";
import { LayoutGrid, UserPlus } from "lucide-react";
import { KpiTiles } from "./KpiTiles";
import { AttentionQueue } from "./AttentionQueue";
import { DailyBrief } from "./DailyBrief";
import { QuickLinks } from "./QuickLinks";

export const metadata = { title: "Dashboard · Recruitment OS" };

// The snapshot must be current on every visit — never served from a static or
// cached render, or "today" silently goes stale.
export const dynamic = "force-dynamic";

/** Skeleton shaped like the eventual content, per spec section 8. */
function DashboardSkeleton() {
  return (
    <div>
      <div className="kpi-grid dash-section">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="card">
            <Skeleton height={14} width="55%" />
            <div className="mt-4">
              <Skeleton height={30} width="35%" />
            </div>
          </div>
        ))}
      </div>
      <div className="card">
        <Skeleton height={16} width="25%" />
        <div className="mt-4">
          <Skeleton height={12} width="60%" />
        </div>
        <div className="mt-3">
          <Skeleton height={12} width="50%" />
        </div>
      </div>
    </div>
  );
}

/** Streams in behind Suspense so the shell and heading paint immediately. */
async function DashboardContent() {
  const membership = await requireMembershipOrRedirect();
  const timezone = resolveTimeZone(membership.organization.timezone);

  const data = await getDashboardData({
    organizationId: membership.organization.id,
    role: membership.role,
    recruiterUserId: membership.user_id,
    timezone,
  });

  const resolved = availableMetrics(data.metrics);
  const hasAnyData =
    Object.values(resolved).some((value) => value > 0) || data.attention.length > 0;

  return (
    <>
      {/* Brief sits above the tiles (spec section 7, step 4). */}
      <DailyBrief hasAnyData={hasAnyData} />
      <KpiTiles metrics={data.metrics} />
      {/*
        A 2-column grid rather than Bulma columns: grid stretches both children
        to the row's height, so the two cards match instead of one towering
        over the other.
      */}
      <div className="dash-bottom">
        <AttentionQueue items={data.attention} status={data.attentionStatus} />
        <QuickLinks />
      </div>
    </>
  );
}

export default async function DashboardPage() {
  const membership = await requireMembershipOrRedirect();
  const timezone = resolveTimeZone(membership.organization.timezone);
  const scope = scopeForRole(membership.role);

  return (
    <AppShell>
      <div className="dash-header dash-section">
        <div>
          {/*
            The org name alone gave the page no identity — it read like an
            org-settings heading. The eyebrow anchors "this is the Dashboard"
            separately from whose dashboard it is.
          */}
          <p className="dash-header__eyebrow">
            <LayoutGrid size={12} aria-hidden="true" />
            Dashboard
          </p>
          <h1 className="dash-header__title">
            {scope === "own" ? "Your workload" : membership.organization.name}
          </h1>
          <p className="dash-header__meta">
            {formatDayInZone(timezone)} · {timezone}
            {scope === "own" && " · showing only applications assigned to you"}
          </p>
        </div>
        <Link className="button is-primary" href="/team/invite">
          <UserPlus size={16} aria-hidden="true" />
          Invite your team
        </Link>
      </div>

      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </AppShell>
  );
}
