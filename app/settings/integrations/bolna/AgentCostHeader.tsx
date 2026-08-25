"use client";

// =============================================================================
// The agent header's cost line and its segmented bar.
//
// WHAT THIS RENDERS TODAY, AND WHY IT IS NOT A NUMBER.
//
// The Cost & Budget Guardrails feature is specified but not built — there is no
// usage ledger to read (see lib/voice/cost.ts). So on this deployment the cost
// line says so, in words, and offers no figure.
//
// That is the deliberate choice. A per-minute cost is the number somebody quotes
// to a client and budgets a campaign against; inventing one from a hardcoded rate
// card would be the most expensive kind of wrong. The architecture rules put it
// plainly for the zero case — "a zero reads as 'nothing happened', which is a
// false statement to a manager" — and a fabricated 9.8 cents is that same false
// statement with a decimal point on it.
//
// Everything below the `not_tracked` branch is finished and tested. The moment
// `call_usage_events` exists, this component starts drawing real segments with no
// further work.
//
// THE BAR REUSES THE ANALYTICS RAMP, and the reuse is careful.
//
// FUNNEL_RAMP is an ORDINAL ramp — light to dark — validated for adjacent-step
// distinguishability. Segments here are CATEGORIES, so the ramp is applied in a
// fixed pipeline order (telephony → transcriber → model → voice, the path the
// audio takes) rather than by size. Colouring the biggest segment darkest would
// double-encode length, which is exactly what app/analytics/charts.tsx warns
// against for bars.
// =============================================================================

import { Info } from "lucide-react";
import { rampStep } from "@/app/analytics/charts";
import {
  COST_COMPONENTS,
  COST_WINDOW_DAYS,
  formatCentsPerMinute,
  type CostEstimate,
  // costModel, NOT cost: this is a client component, and lib/voice/cost.ts
  // imports the server Supabase client. Importing one value from there pulled
  // `next/headers` into the browser bundle and broke the build.
} from "@/lib/voice/costModel";

/** Fixed colour per component, so a component keeps its colour between agents. */
function componentColor(component: string): string {
  const index = (COST_COMPONENTS as readonly string[]).indexOf(component);
  return rampStep(index < 0 ? 0 : index);
}

export function AgentCostHeader({ estimate }: { estimate: CostEstimate }) {
  if (estimate.state === "not_tracked") {
    return (
      <p className="vac-cost vac-cost--pending">
        <Info size={13} aria-hidden="true" />
        <span>
          Cost per minute isn&apos;t tracked yet — usage metering hasn&apos;t been switched on for
          this deployment, so there&apos;s no measured figure to show.
        </span>
      </p>
    );
  }

  if (estimate.state === "failed") {
    /*
      Said differently from "not tracked" on purpose. One is a build state, the
      other is a bug — reporting the second as the first would hide it, which the
      architecture rules single out as the trap.
    */
    return (
      <p className="vac-cost vac-cost--pending">
        <Info size={13} aria-hidden="true" />
        <span>Couldn&apos;t read this month&apos;s usage, so the cost estimate is unavailable.</span>
      </p>
    );
  }

  if (estimate.state === "no_data") {
    return (
      <p className="vac-cost vac-cost--pending">
        <Info size={13} aria-hidden="true" />
        <span>
          No calls in the last {COST_WINDOW_DAYS} days, so there&apos;s nothing to estimate a
          per-minute cost from yet.
        </span>
      </p>
    );
  }

  const minutes = Math.round(estimate.minutesSampled);

  return (
    <div className="vac-cost">
      <p className="vac-cost__headline">
        Estimated cost per minute:{" "}
        <strong>~{formatCentsPerMinute(estimate.centsPerMinute)}</strong>
        {/* The sample size, so a figure averaged over four minutes is not read
            with the same confidence as one averaged over four hundred. */}
        <span className="vac-cost__basis">
          {" "}
          · from {minutes} {minutes === 1 ? "minute" : "minutes"} of calls in the last{" "}
          {COST_WINDOW_DAYS} days
        </span>
      </p>

      {estimate.totalOnly ? (
        <>
          {/*
            A SINGLE-COLOUR BAR. The total is real; the split is not available, so
            none is drawn. Dividing a known total into plausible-looking
            proportions is the fabrication this whole component avoids.
          */}
          <div className="vac-costbar" role="img" aria-label="Total cost per minute, no breakdown available">
            <span
              className="vac-costbar__segment"
              style={{ width: "100%", background: rampStep(2) }}
            />
          </div>
          <p className="vac-cost__note">
            Recorded as a total only — no per-component breakdown is available, so none is shown.
          </p>
        </>
      ) : (
        <>
          <div
            className="vac-costbar"
            role="img"
            aria-label={estimate.segments
              .map(
                (segment) =>
                  `${segment.label} ${formatCentsPerMinute(segment.centsPerMinute)} per minute`
              )
              .join(", ")}
          >
            {estimate.segments.map((segment) => (
              <span
                key={segment.component}
                className="vac-costbar__segment"
                style={{
                  width: `${segment.percent}%`,
                  background: componentColor(segment.component),
                }}
              />
            ))}
          </div>

          {/* Dot + label, because the bar's colours mean nothing on their own —
              and a screen reader gets the same facts from the aria-label above. */}
          <ul className="vac-costlegend">
            {estimate.segments.map((segment) => (
              <li key={segment.component}>
                <span
                  className="vac-costlegend__dot"
                  style={{ background: componentColor(segment.component) }}
                  aria-hidden="true"
                />
                {segment.label}
                <span className="vac-costlegend__value">
                  {formatCentsPerMinute(segment.centsPerMinute)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
