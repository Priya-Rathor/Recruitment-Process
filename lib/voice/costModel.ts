// =============================================================================
// The cost MODEL — types and arithmetic. No database, no clock, no server APIs.
//
// WHY THIS IS A SEPARATE FILE FROM cost.ts.
//
// The console's cost header is a client component, and it needs the labels, the
// formatter and the component order. Those used to live beside
// getAgentCostEstimate(), which imports lib/supabase/server.ts — so importing one
// value pulled the server Supabase client, and `next/headers` with it, into the
// browser bundle. That is a build error in the App Router, and it would have been
// wrong even if it had built: nothing in a browser bundle should reference the
// service-side client.
//
// The rule this file exists to hold: a module a CLIENT component imports may not
// touch a database. Same split as lib/voice/catalog.ts (client-safe types) against
// the provider adapter (server only). costModel.test.ts asserts it stays true.
//
// The read is in cost.ts and imports from here — never the other way round.
// =============================================================================

/**
 * The four things a spoken minute is made of.
 *
 * Ordered along the PATH THE AUDIO TAKES — the call arrives (telephony), is
 * transcribed (stt), reasoned about (llm), and spoken back (tts). That ordering
 * is why a colour ramp can be used for these segments without double-encoding:
 * colour says which component, length says how much. Ordering them by size
 * instead would make colour and length say the same thing.
 */
export const COST_COMPONENTS = ["telephony", "stt", "llm", "tts"] as const;
export type CostComponent = (typeof COST_COMPONENTS)[number];

export const COMPONENT_LABELS: Record<CostComponent, string> = {
  telephony: "Telephony",
  stt: "Transcriber",
  llm: "Language model",
  tts: "Voice",
};

/** One usage row, already reduced to what the arithmetic needs. */
export type UsageEvent = {
  component: CostComponent;
  costCents: number;
  /** Billable seconds this row covers. */
  seconds: number;
};

export type CostSegment = {
  component: CostComponent;
  label: string;
  centsPerMinute: number;
  /** Share of the total, 0-100, already widened so a real value stays visible. */
  percent: number;
};

export type CostEstimate =
  /**
   * The ledger does not exist yet. A BUILD STATE, not an error and not zero.
   * The UI says so plainly and offers no number.
   */
  | { state: "not_tracked" }
  /** The ledger exists but this organization has no calls in the window. */
  | { state: "no_data" }
  /** The read failed. Distinct from not_tracked — this one is a bug to chase. */
  | { state: "failed" }
  /**
   * Real usage, and a real breakdown.
   *
   * `segments` may hold fewer than four components: only what was actually
   * recorded. A component with no rows is absent rather than shown as zero,
   * because "we did not measure this" and "this cost nothing" are different.
   */
  | {
      state: "ready";
      centsPerMinute: number;
      segments: CostSegment[];
      /** Minutes the estimate is averaged over, so the UI can say how solid it is. */
      minutesSampled: number;
      /**
       * True when only a total was recoverable — no per-component rows.
       *
       * The console then draws a SINGLE-COLOUR bar instead of a segmented one.
       * Splitting a known total into invented proportions would be the exact
       * fabrication this module exists to avoid.
       */
      totalOnly: boolean;
    };

/** How far back to average. Long enough to smooth, short enough to be current. */
export const COST_WINDOW_DAYS = 30;

// -----------------------------------------------------------------------------
// The arithmetic. No database, no clock.
// -----------------------------------------------------------------------------

/**
 * Reduces usage rows to a per-minute cost and its segments.
 *
 * Returns null when there is nothing to divide by — a caller must not turn that
 * into a zero.
 */
export function summarizeUsage(events: UsageEvent[]): {
  centsPerMinute: number;
  segments: CostSegment[];
  minutesSampled: number;
} | null {
  const usable = events.filter(
    (event) =>
      Number.isFinite(event.costCents) &&
      Number.isFinite(event.seconds) &&
      event.costCents >= 0 &&
      event.seconds > 0
  );
  if (usable.length === 0) return null;

  const totalSeconds = usable.reduce((sum, event) => sum + event.seconds, 0);
  if (totalSeconds <= 0) return null;

  const minutes = totalSeconds / 60;

  const byComponent = new Map<CostComponent, number>();
  let totalCents = 0;

  for (const event of usable) {
    byComponent.set(event.component, (byComponent.get(event.component) ?? 0) + event.costCents);
    totalCents += event.costCents;
  }

  const centsPerMinute = totalCents / minutes;

  // Zero total with real duration is a legitimate answer (a free tier, a
  // self-hosted model) — but there are no proportions to draw, so no segments.
  if (totalCents <= 0) {
    return { centsPerMinute: 0, segments: [], minutesSampled: minutes };
  }

  const segments: CostSegment[] = COST_COMPONENTS.filter((component) =>
    byComponent.has(component)
  ).map((component) => {
    const cents = byComponent.get(component) ?? 0;
    return {
      component,
      label: COMPONENT_LABELS[component],
      centsPerMinute: cents / minutes,
      percent: segmentPercent(cents, totalCents),
    };
  });

  return { centsPerMinute, segments, minutesSampled: minutes };
}

/**
 * A segment's share of the bar.
 *
 * Same reasoning as barWidthPercent() in the analytics charts, and the same trap:
 * a real-but-tiny component (telephony at 0.3% of the bill) rounds to a width of
 * zero and vanishes, which reads as "not measured" when it was. A non-zero value
 * therefore always keeps a visible sliver.
 */
export function segmentPercent(cents: number, totalCents: number): number {
  if (!Number.isFinite(cents) || !Number.isFinite(totalCents) || totalCents <= 0) return 0;
  if (cents <= 0) return 0;
  return Math.min(Math.max((cents / totalCents) * 100, 1.5), 100);
}

/** Cents to a display string. Sub-cent costs are the norm here, so 3dp. */
export function formatCentsPerMinute(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1) return `$${dollars.toFixed(2)}`;
  // "~$0.098" — three decimals, because two would render most real per-minute
  // costs as $0.10 and hide the difference between models.
  return `$${dollars.toFixed(3)}`;
}
