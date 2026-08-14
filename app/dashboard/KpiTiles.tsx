// KPI tiles. Design tokens per spec section 4: value 28-32px bold #0F172A,
// label 13-14px #64748B, flat white card with a 1px #E2E8F0 border.
import { METRIC_LABELS, METRIC_SOURCE, type MetricKey, type MetricResult } from "@/lib/dashboard/metrics";

const TILE_ORDER: MetricKey[] = [
  "newCandidates",
  "screeningsCompleted",
  "interviewsToday",
  "overdueApplications",
  "failedCalls",
  "failedAutomations",
];

/** Metrics whose non-zero value is itself bad news, so the value is tinted. */
const NEGATIVE_METRICS = new Set<MetricKey>([
  "overdueApplications",
  "failedCalls",
  "failedAutomations",
]);

function valueColor(key: MetricKey, value: number): string {
  if (!NEGATIVE_METRICS.has(key) || value === 0) return "var(--color-text)";
  return key === "overdueApplications" ? "var(--color-warning)" : "var(--color-error)";
}

function Tile({ metricKey, result }: { metricKey: MetricKey; result: MetricResult }) {
  const label = METRIC_LABELS[metricKey];

  return (
    <div className="card" style={{ height: "100%" }}>
      {result.status === "ok" && (
        <>
          <p
            style={{
              fontSize: 30,
              fontWeight: 700,
              lineHeight: 1.1,
              color: valueColor(metricKey, result.value),
            }}
          >
            {result.value}
          </p>
          <p className="has-text-secondary mt-1" style={{ fontSize: 13 }}>
            {label}
          </p>
        </>
      )}

      {/* Honest about not-yet-available data: an em dash plus which module will
          fill it in, rather than a zero that reads as "nothing happened". */}
      {result.status === "pending" && (
        <>
          <p
            style={{
              fontSize: 30,
              fontWeight: 700,
              lineHeight: 1.1,
              color: "var(--color-border)",
            }}
          >
            —
          </p>
          <p className="has-text-secondary mt-1" style={{ fontSize: 13 }}>
            {label}
          </p>
          <p className="has-text-secondary" style={{ fontSize: 11 }}>
            Available with Module {result.module}
          </p>
        </>
      )}

      {result.status === "error" && (
        <>
          <p style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: "var(--color-error)" }}>
            !
          </p>
          <p className="has-text-secondary mt-1" style={{ fontSize: 13 }}>
            {label}
          </p>
          <p style={{ fontSize: 11, color: "var(--color-error)" }}>Couldn&apos;t load</p>
        </>
      )}
    </div>
  );
}

export function KpiTiles({ metrics }: { metrics: Record<MetricKey, MetricResult> }) {
  const pendingCount = TILE_ORDER.filter((key) => metrics[key].status === "pending").length;

  return (
    <>
      {/* Bulma's is-multiline grid stacks to a single column on mobile. */}
      <div className="columns is-multiline">
        {TILE_ORDER.map((key) => (
          <div key={key} className="column is-one-third-tablet is-one-quarter-desktop">
            <Tile metricKey={key} result={metrics[key]} />
          </div>
        ))}
      </div>

      {pendingCount > 0 && (
        <p className="has-text-secondary mb-5" style={{ fontSize: 12 }}>
          {pendingCount} of {TILE_ORDER.length} tiles are waiting on modules that aren&apos;t built
          yet. They&apos;ll populate automatically once those tables exist — see{" "}
          <code style={{ fontSize: 11 }}>docs/modules/02-dashboard-retrofit.md</code>.
        </p>
      )}
    </>
  );
}

export { TILE_ORDER, METRIC_SOURCE };
