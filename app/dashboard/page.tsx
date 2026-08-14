import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/states";
import { requireMembershipOrRedirect } from "@/lib/tenant";
import { formatDayInZone, resolveTimeZone } from "@/lib/time";
import { availableMetrics, getDashboardData, scopeForRole } from "@/lib/dashboard/metrics";
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
      <div className="columns is-multiline">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="column is-one-third-tablet is-one-quarter-desktop">
            <div className="card">
              <Skeleton height={32} width="45%" />
              <div className="mt-2">
                <Skeleton height={12} width="70%" />
              </div>
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
      <div className="columns">
        <div className="column is-two-thirds">
          <AttentionQueue items={data.attention} pending={data.attentionPending} />
        </div>
        <div className="column">
          <QuickLinks />
        </div>
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
      <div className="is-flex is-justify-content-space-between is-align-items-flex-end mb-5">
        <div>
          <h1 className="title is-4 mb-1">
            {scope === "own" ? "Your workload" : membership.organization.name}
          </h1>
          <p className="has-text-secondary" style={{ fontSize: 13 }}>
            {formatDayInZone(timezone)} · {timezone}
            {scope === "own" && " · showing only applications assigned to you"}
          </p>
        </div>
        <Link className="button is-primary" href="/team/invite">
          Invite your team
        </Link>
      </div>

      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </AppShell>
  );
}
