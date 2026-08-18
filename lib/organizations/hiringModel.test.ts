import { describe, expect, it } from "vitest";
import { isAgencyMode, parseAgencyMode } from "./hiringModel";

describe("isAgencyMode", () => {
  it("is true for an agency", () => {
    expect(isAgencyMode({ agency_mode: true })).toBe(true);
  });

  it("is false only for an explicit false", () => {
    expect(isAgencyMode({ agency_mode: false })).toBe(false);
  });

  /**
   * The important one. Migrations are applied by hand, so there is a window
   * where the code knows about the column and the database does not. Failing
   * open to "agency" keeps a live agency's Clients module visible; failing the
   * other way would delete it from their navigation without warning.
   */
  it("treats a missing or null flag as an agency, never as in-house", () => {
    expect(isAgencyMode({})).toBe(true);
    expect(isAgencyMode({ agency_mode: null })).toBe(true);
    expect(isAgencyMode(null)).toBe(true);
    expect(isAgencyMode(undefined)).toBe(true);
  });
});

describe("parseAgencyMode", () => {
  it("distinguishes absent from false", () => {
    expect(parseAgencyMode(undefined)).toEqual({ ok: true, value: undefined });
    expect(parseAgencyMode(false)).toEqual({ ok: true, value: false });
    expect(parseAgencyMode(true)).toEqual({ ok: true, value: true });
  });

  it("rejects the truthy strings a form would send if it were careless", () => {
    expect(parseAgencyMode("false").ok).toBe(false);
    expect(parseAgencyMode("true").ok).toBe(false);
    expect(parseAgencyMode(1).ok).toBe(false);
    expect(parseAgencyMode(null).ok).toBe(false);
  });
});
