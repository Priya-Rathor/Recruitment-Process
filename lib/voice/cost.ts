// =============================================================================
// Reading the cost ledger. SERVER ONLY — this file touches the database.
//
// READ THIS BEFORE CHANGING ANYTHING HERE.
//
// The Cost & Budget Guardrails feature (docs/modules/00-cost-tracking.md) is
// SPECIFIED BUT NOT BUILT. There is no `call_usage_events` table and no cost
// ledger anywhere in this codebase — I checked the migrations before writing this.
//
// So this module does not compute a cost today. It computes one the moment that
// ledger exists, and until then returns an explicit `not_tracked` state that the
// UI labels as such.
//
// WHY NOT JUST SHOW A NUMBER
//
// The obvious shortcut is a rate card: multiply a per-minute price by a duration
// and print "~$0.098". Every input to that is invented — nobody has configured a
// price, and the provider's pricing is not exposed to us. A fabricated cost is
// worse than no cost, because a plausible number gets budgeted against, quoted to
// a client, and used to choose between models. The architecture rules already say
// this about zeros: "a zero reads as 'nothing happened', which is a false
// statement to a manager". A made-up 9.8 cents is that with a decimal point.
//
// The distinction this module is careful about is the one the rules single out:
// "table not built" is NOT the same as "the query failed". One is a build state,
// the other is a bug, and reporting the second as the first would hide it.
//
// THE TYPES AND THE ARITHMETIC ARE IN lib/voice/costModel.ts, which is safe for a
// client component to import. Nothing here may be imported by one.
// =============================================================================
import { createClient } from "@/lib/supabase/server";
import { isMissingRelation } from "@/lib/dashboard/metrics";
import { formatDbError } from "@/lib/supabase/errors";
import {
  COST_COMPONENTS,
  COST_WINDOW_DAYS,
  summarizeUsage,
  type CostComponent,
  type CostEstimate,
  type UsageEvent,
} from "@/lib/voice/costModel";

// -----------------------------------------------------------------------------
// The read.
// -----------------------------------------------------------------------------

type UsageRow = {
  component: string | null;
  cost_cents: number | null;
  billable_seconds: number | null;
};

function isCostComponent(value: unknown): value is CostComponent {
  return typeof value === "string" && (COST_COMPONENTS as readonly string[]).includes(value);
}

/**
 * This organization's per-minute voice cost, from OUR OWN usage ledger.
 *
 * Deliberately reads `call_usage_events` and nothing else. It does not ask the
 * provider for an account balance, a spend figure or a price list: a billing
 * balance is the provider's own surface, it is not per-organization in a
 * multi-tenant deployment, and showing somebody else's balance as "your cost"
 * would be worse than showing nothing.
 */
export async function getAgentCostEstimate({
  organizationId,
}: {
  organizationId: string;
}): Promise<CostEstimate> {
  const supabase = await createClient();

  const since = new Date(Date.now() - COST_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("call_usage_events")
    .select("component, cost_cents, billable_seconds")
    .eq("organization_id", organizationId)
    .gte("created_at", since);

  if (error) {
    if (isMissingRelation(error)) {
      // The ledger has not been built. Expected today; logged at info so it does
      // not raise the dev overlay's error count on every console load and teach
      // people to ignore it.
      console.info(
        "[voice/cost] call_usage_events does not exist yet — the Cost & Budget Guardrails feature is unbuilt. Reporting cost as untracked."
      );
      return { state: "not_tracked" };
    }
    console.error(`[voice/cost] usage read failed: ${formatDbError(error)}`);
    return { state: "failed" };
  }

  const rows = (data ?? []) as unknown as UsageRow[];

  const events: UsageEvent[] = [];
  let unattributedCents = 0;
  let unattributedSeconds = 0;

  for (const row of rows) {
    const cents = typeof row.cost_cents === "number" ? row.cost_cents : 0;
    const seconds = typeof row.billable_seconds === "number" ? row.billable_seconds : 0;

    if (isCostComponent(row.component)) {
      events.push({ component: row.component, costCents: cents, seconds });
      continue;
    }

    /*
      A row the ledger recorded WITHOUT a component — a whole-call charge, or a
      component name this build does not know. It still counts toward the total,
      but it cannot be drawn as a segment, so it forces the single-colour bar.
      Guessing which component it belonged to is exactly the fabrication this
      module refuses.
    */
    unattributedCents += cents;
    unattributedSeconds += seconds;
  }

  const attributed = summarizeUsage(events);

  if (!attributed) {
    // Nothing attributable. If there is unattributed spend we can still report a
    // total honestly — as a total, with no breakdown.
    if (unattributedSeconds > 0 && unattributedCents >= 0) {
      const minutes = unattributedSeconds / 60;
      return {
        state: "ready",
        centsPerMinute: unattributedCents / minutes,
        segments: [],
        minutesSampled: minutes,
        totalOnly: true,
      };
    }
    return { state: "no_data" };
  }

  // Mixed: some rows attributed, some not. The total must include both, and the
  // bar must not pretend the breakdown covers all of it.
  if (unattributedCents > 0) {
    const totalMinutes = attributed.minutesSampled + unattributedSeconds / 60;
    const totalCents =
      attributed.centsPerMinute * attributed.minutesSampled + unattributedCents;

    return {
      state: "ready",
      centsPerMinute: totalMinutes > 0 ? totalCents / totalMinutes : 0,
      segments: [],
      minutesSampled: totalMinutes,
      totalOnly: true,
    };
  }

  return {
    state: "ready",
    centsPerMinute: attributed.centsPerMinute,
    segments: attributed.segments,
    minutesSampled: attributed.minutesSampled,
    totalOnly: attributed.segments.length === 0,
  };
}
