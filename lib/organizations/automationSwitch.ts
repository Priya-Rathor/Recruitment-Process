// =============================================================================
// THE KILL SWITCH — is this organization's automation engine on?
//
// One boolean on `organizations` (migration 0029), read before the engine loads a
// single rule. It exists for the 2am case: a rule is misbehaving and the person
// who can stop it needs one switch, not eight rules opened one at a time while it
// keeps running.
//
// Lives on `organizations` for the same reason `agency_mode` and `timezone` do —
// it is carried on every membership lookup, so no page needs a second query to
// find out whether to say "automations are paused".
// =============================================================================

/** Just the field, so callers can pass a membership's organization directly. */
export type AutomationSwitchOrganization = { automations_enabled?: boolean | null };

/**
 * True when the engine may run.
 *
 * `!== false`, not `=== true`, following isAgencyMode() and for the same reason:
 * migrations here are applied by hand, so between deploying this code and running
 * 0029 the column is simply absent. Absent must read as ON, because that is what
 * every organization was before the switch existed — reading it as OFF would
 * silently stop a live organization's automations until somebody noticed, which
 * is exactly the failure the switch is meant to prevent, caused by the switch.
 *
 * Note this is the ONLY place that reading is generous. Inside the engine,
 * `readOrganizationGate()` treats a FAILED READ as unknown and stops — because
 * there the question is "may we act on a candidate right now?", and the safe
 * answer to a database error is no.
 */
export function automationsEnabled(
  organization: AutomationSwitchOrganization | null | undefined
): boolean {
  return organization?.automations_enabled !== false;
}
