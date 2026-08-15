// =============================================================================
// Making a PostgREST error readable.
//
// WHY THIS EXISTS: `console.error("[applications] list failed:", error)` printed
// `{}` in the Next dev overlay. The error object was a plain PostgrestError
// whose fields did not survive the overlay's serialisation, so a perfectly
// diagnosable fault — a column that does not exist — reached a human as an
// empty object and cost a round trip to work out.
//
// Every field is pulled out by name here, so the log always says something.
// =============================================================================

export type PostgrestLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  /** Present on some supabase-js errors; the only fact a HEAD request leaves. */
  status?: number | null;
  statusText?: string | null;
};

/** A flat, always-loggable description. Never returns an empty object. */
export function describeDbError(error: unknown): Record<string, string> {
  if (!error) return { message: "unknown error (null)" };

  if (typeof error === "string") return { message: error };

  const candidate = error as PostgrestLikeError & { name?: string; stack?: string };

  const described: Record<string, string> = {};
  if (candidate.code) described.code = String(candidate.code);
  if (candidate.message) described.message = String(candidate.message);
  if (candidate.details) described.details = String(candidate.details);
  if (candidate.hint) described.hint = String(candidate.hint);

  // A `head: true` count request gets no response BODY, so PostgREST's message
  // never reaches the client — the status is the only thing left to report, and
  // without it the log reads `{message: ""}`, which is what sent someone
  // hunting for a bug that was really an unapplied migration.
  if (typeof candidate.status === "number") described.status = String(candidate.status);
  if (candidate.statusText) described.statusText = String(candidate.statusText);

  if (Object.keys(described).length === 0) {
    const serialised = (() => {
      try {
        return JSON.stringify(error);
      } catch {
        return String(error);
      }
    })();

    // `{"message":""}` is what a failed `head: true` count produces: PostgREST
    // sent an error status, the HEAD response carried no body, and supabase-js
    // had nothing to fill the error with. Printing the empty shell sends people
    // hunting; naming the limitation and the way round it does not.
    described.message =
      serialised === '{"message":""}' || serialised === "{}"
        ? "no detail available — a `head: true` count returns no response body; " +
          "re-run the same query without `head` to see the database's message"
        : serialised;
  }

  return described;
}

/**
 * Whether this error means "the schema is behind the code", rather than
 * "something went wrong".
 *
 * A missing TABLE (42P01 / PGRST205) and a missing COLUMN (42703 / PGRST204)
 * are the same class of fact: a migration has not been applied. Both are
 * actionable in a way a timeout or an RLS denial is not, and telling them apart
 * is what lets the UI say "run the migration" instead of "couldn't load".
 *
 * DELIBERATELY NARROW. AGENTS.md's rule is that reporting a real failure as
 * "not built yet" hides genuine bugs, so this matches on error CODES rather
 * than on message text — an RLS denial (42501) or a statement timeout is never
 * going to be mistaken for a pending migration.
 */
export function isSchemaOutOfDate(error: unknown): boolean {
  const code = (error as PostgrestLikeError | null)?.code;
  return (
    code === "42P01" || // undefined_table
    code === "42703" || // undefined_column
    code === "PGRST205" || // table not in the schema cache
    code === "PGRST204" // column not in the schema cache
  );
}

/**
 * The same description as ONE STRING, for `console.error`.
 *
 * WHY A STRING AND NOT THE OBJECT: Next's dev overlay renders server-side
 * console output by serialising each argument, and a plain object arrives as
 * `{}`. So `console.error(`failed: ${formatDbError(error)}`)` reads perfectly in
 * a terminal and tells a developer looking at the overlay — which is where they
 * actually look — precisely nothing. A string survives intact.
 *
 * Every call site therefore interpolates this rather than passing a second
 * argument.
 */
export function formatDbError(error: unknown): string {
  const described = describeDbError(error);

  const code = described.code ? `${described.code}: ` : "";
  const parts = [described.message, described.details, described.hint]
    .filter((part): part is string => Boolean(part))
    .join(" — ");

  const status = described.status ? ` (HTTP ${described.status})` : "";

  return `${code}${parts || "no detail"}${status}`;
}

/** The message a user sees when the schema is behind the code. */
export const SCHEMA_OUT_OF_DATE_MESSAGE =
  "This page needs a database migration that hasn't been applied yet. " +
  "Apply the pending files in supabase/migrations/ and reload.";
