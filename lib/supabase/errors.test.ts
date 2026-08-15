import { describe, expect, it } from "vitest";
import { describeDbError, formatDbError, isSchemaOutOfDate } from "@/lib/supabase/errors";

describe("describeDbError", () => {
  /**
   * The bug this exists for: a PostgrestError logged directly printed `{}` in
   * the Next dev overlay, so "column applications.rejected_at_stage does not
   * exist" reached a human as an empty object.
   */
  it("never returns an empty object", () => {
    for (const input of [null, undefined, {}, 0, false, [], new Error("boom")]) {
      expect(Object.keys(describeDbError(input)).length, String(input)).toBeGreaterThan(0);
    }
  });

  it("pulls out every PostgREST field by name", () => {
    expect(
      describeDbError({
        code: "42703",
        message: "column applications.rejected_at_stage does not exist",
        details: null,
        hint: null,
      })
    ).toEqual({
      code: "42703",
      message: "column applications.rejected_at_stage does not exist",
    });
  });

  it("keeps details and hint when the database supplies them", () => {
    expect(
      describeDbError({ code: "23505", message: "duplicate", details: "Key exists", hint: "Use upsert" })
    ).toEqual({ code: "23505", message: "duplicate", details: "Key exists", hint: "Use upsert" });
  });

  it("falls back to a serialisation for a shape it does not recognise", () => {
    expect(describeDbError({ unexpected: true }).message).toContain("unexpected");
  });

  it("reports the HTTP status when a HEAD request left no body", () => {
    // A `head: true` count query gets no response body, so PostgREST's message
    // never arrives. Without the status the log reads `{message: ""}`.
    expect(describeDbError({ message: "", status: 400, statusText: "Bad Request" })).toEqual({
      status: "400",
      statusText: "Bad Request",
    });
  });

  it("explains the empty error a failed count produces, rather than echoing it", () => {
    // `{"message":""}` is exactly what supabase-js yields when a `head: true`
    // request fails: there is no response body to read a message from.
    const described = describeDbError({ message: "" });
    expect(described.message).toContain("head");
    expect(described.message).not.toBe('{"message":""}');
  });

  it("passes a plain string through", () => {
    expect(describeDbError("network unreachable")).toEqual({ message: "network unreachable" });
  });
});

describe("formatDbError", () => {
  /**
   * The reason this exists at all: Next's dev overlay serialises a second
   * console.error argument to `{}`, so the object form told a developer
   * looking at the overlay nothing. A string survives.
   */
  it("returns a string, always", () => {
    for (const input of [null, undefined, {}, "text", { code: "42703" }, new Error("x")]) {
      expect(typeof formatDbError(input), String(input)).toBe("string");
      expect(formatDbError(input).length, String(input)).toBeGreaterThan(0);
    }
  });

  it("leads with the code, then the message", () => {
    expect(
      formatDbError({
        code: "42703",
        message: "column applications.rejected_at_stage does not exist",
      })
    ).toBe("42703: column applications.rejected_at_stage does not exist");
  });

  it("joins details and hint onto the message", () => {
    expect(
      formatDbError({ code: "23505", message: "duplicate", details: "Key exists", hint: "Upsert" })
    ).toBe("23505: duplicate — Key exists — Upsert");
  });

  it("appends the HTTP status when that is all there is", () => {
    expect(formatDbError({ status: 400 })).toBe("no detail (HTTP 400)");
  });

  it("never renders as an empty object or an empty string", () => {
    // The two exact strings that appeared in the overlay before this existed.
    for (const input of [{}, { message: "" }, null]) {
      const formatted = formatDbError(input);
      expect(formatted).not.toBe("{}");
      expect(formatted).not.toBe("");
    }
  });
});

describe("isSchemaOutOfDate", () => {
  it("recognises a missing table and a missing column", () => {
    // Both mean the same thing: a migration has not been applied.
    expect(isSchemaOutOfDate({ code: "42P01" })).toBe(true);
    expect(isSchemaOutOfDate({ code: "42703" })).toBe(true);
    expect(isSchemaOutOfDate({ code: "PGRST205" })).toBe(true);
    expect(isSchemaOutOfDate({ code: "PGRST204" })).toBe(true);
  });

  /**
   * The rule AGENTS.md sets: reporting a real failure as "not built yet" hides
   * genuine bugs. An RLS denial is the one that would hurt most — it means a
   * policy is wrong, and calling it a pending migration would send someone to
   * run SQL that changes nothing.
   */
  it("does NOT swallow a permission error, a conflict or a timeout", () => {
    expect(isSchemaOutOfDate({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isSchemaOutOfDate({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(isSchemaOutOfDate({ code: "57014", message: "statement timeout" })).toBe(false);
    expect(isSchemaOutOfDate({ code: "PGRST301", message: "JWT expired" })).toBe(false);
  });

  it("matches on the code, never on the message text", () => {
    // A row whose DATA contains the phrase must not be read as a schema fault.
    expect(
      isSchemaOutOfDate({ code: "42501", message: "column applications.foo does not exist" })
    ).toBe(false);
  });

  it("is false for a null or shapeless error", () => {
    expect(isSchemaOutOfDate(null)).toBe(false);
    expect(isSchemaOutOfDate(undefined)).toBe(false);
    expect(isSchemaOutOfDate({})).toBe(false);
  });
});
