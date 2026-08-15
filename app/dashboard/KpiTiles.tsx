// =============================================================================
// KPI tiles.
//
// TWO LAYOUT DECISIONS, both fixing things the design review flagged.
//
// 1. THREE COLUMNS, NOT FOUR. Six tiles in a four-column grid leaves two
//    dangling on a second row with a hole to their right, which reads as a
//    broken layout rather than an intentional one. 3×2 fills both rows exactly,
//    and it groups meaningfully by accident of order: row one is work happening,
//    row two is work going wrong.
//
// 2. AN ICON PER CATEGORY. Six tiles whose only difference was a number were
//    indistinguishable at a glance. The icon is the thing the eye lands on when
//    scanning for "the calls one".
//
// The failure tiles earn a red icon and a left accent ONLY when their value is
// non-zero. A dashboard where the failure tiles are permanently red teaches
// people to ignore red — the colour has to mean something happened.
// =============================================================================
import {
  CalendarDays,
  Clock,
  PhoneCall,
  PhoneOff,
  UserPlus,
  ZapOff,
  type LucideIcon,
} from "lucide-react";
import { METRIC_LABELS, METRIC_SOURCE, type MetricKey, type MetricResult } from "@/lib/dashboard/metrics";

const TILE_ORDER: MetricKey[] = [
  // Row one — work happening.
  "newCandidates",
  "screeningsCompleted",
  "interviewsToday",
  // Row two — work going wrong.
  "overdueApplications",
  "failedCalls",
  "failedAutomations",
];

const TILE_ICONS: Record<MetricKey, LucideIcon> = {
  newCandidates: UserPlus,
  screeningsCompleted: PhoneCall,
  interviewsToday: CalendarDays,
  overdueApplications: Clock,
  failedCalls: PhoneOff,
  failedAutomations: ZapOff,
};

/** Metrics whose non-zero value is itself bad news, so the tile is tinted. */
const NEGATIVE_METRICS = new Set<MetricKey>([
  "overdueApplications",
  "failedCalls",
  "failedAutomations",
]);

/**
 * Overdue is amber, failures are red.
 *
 * Deliberately different: an application sitting too long needs a nudge, a
 * failed call to a candidate needs someone now. Flattening both to red would
 * lose that, and the amber/red split is already how the pipeline board reads.
 */
function accentFor(key: MetricKey, value: number): string | null {
  if (!NEGATIVE_METRICS.has(key) || value <= 0) return null;
  return key === "overdueApplications" ? "var(--color-warning)" : "var(--color-error)";
}

function Tile({ metricKey, result }: { metricKey: MetricKey; result: MetricResult }) {
  const label = METRIC_LABELS[metricKey];
  const Icon = TILE_ICONS[metricKey];

  const accent = result.status === "ok" ? accentFor(metricKey, result.value) : null;

  return (
    <div
      className="card kpi-tile"
      style={accent ? { borderLeft: `3px solid ${accent}` } : undefined}
    >
      <div className="kpi-tile__head">
        <Icon
          size={20}
          strokeWidth={1.75}
          aria-hidden="true"
          style={{ color: accent ?? "var(--color-text-secondary)" }}
        />
        <span className="kpi-tile__label">{label}</span>
      </div>

      {result.status === "ok" && (
        <p className="kpi-tile__value" style={accent ? { color: accent } : undefined}>
          {result.value}
        </p>
      )}

      {/* Honest about not-yet-available data: an em dash plus which module will
          fill it in, rather than a zero that reads as "nothing happened". */}
      {result.status === "pending" && (
        <>
          <p className="kpi-tile__value" style={{ color: "var(--color-border)" }}>
            —
          </p>
          <p className="kpi-tile__note">Available with Module {result.module}</p>
        </>
      )}

      {result.status === "error" && (
        <>
          <p className="kpi-tile__value" style={{ color: "var(--color-error)" }}>
            !
          </p>
          <p className="kpi-tile__note" style={{ color: "var(--color-error)" }}>
            Couldn&apos;t load
          </p>
        </>
      )}
    </div>
  );
}

export function KpiTiles({ metrics }: { metrics: Record<MetricKey, MetricResult> }) {
  const pendingCount = TILE_ORDER.filter((key) => metrics[key].status === "pending").length;

  const allZero = TILE_ORDER.every(
    (key) => metrics[key].status === "ok" && metrics[key].value === 0
  );

  return (
    <section className="dash-section">
      <div className="kpi-grid">
        {TILE_ORDER.map((key) => (
          <Tile key={key} metricKey={key} result={metrics[key]} />
        ))}
      </div>

      {/*
        Six zeros with no explanation reads as "something is broken". This says
        the quiet part: nothing is wrong, there is simply nothing yet.
      */}
      {allZero && (
        <p className="kpi-grid__caption">
          Your numbers will appear here as your team starts adding candidates and jobs.
        </p>
      )}

      {pendingCount > 0 && (
        <p className="kpi-grid__caption">
          {pendingCount} of {TILE_ORDER.length} tiles are waiting on modules that aren&apos;t built
          yet. They&apos;ll populate automatically once those tables exist.
        </p>
      )}
    </section>
  );
}

export { TILE_ORDER, METRIC_SOURCE };
