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

  if (Object.keys(described).length === 0) {
    // Last resort: something that is not shaped like a PostgREST error at all.
    described.message = (() => {
      try {
        return JSON.stringify(error);
      } catch {
        return String(error);
      }
    })();
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

/** The message a user sees when the schema is behind the code. */
export const SCHEMA_OUT_OF_DATE_MESSAGE =
  "This page needs a database migration that hasn't been applied yet. " +
  "Apply the pending files in supabase/migrations/ and reload.";
