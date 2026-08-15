// Shared route-handler helpers. Every later module's API routes should use
// these so error shapes stay consistent across all 17 modules.
import { NextResponse } from "next/server";
import { TenantError } from "@/lib/tenant";
import { formatDbError } from "@/lib/supabase/errors";

export type ApiError = { error: string };

export function jsonError(message: string, status: number) {
  return NextResponse.json<ApiError>({ error: message }, { status });
}

/**
 * Converts a thrown error into a response. TenantError carries its own status;
 * anything else becomes a 500 with a generic message, so internal details and
 * raw provider/database errors never leak to the browser (spec: "raw provider
 * stack traces are never shown to users").
 */
export function handleRouteError(error: unknown) {
  if (error instanceof TenantError) {
    return jsonError(error.message, error.status);
  }
  console.error(`[api] unhandled error: ${formatDbError(error)}`);
  return jsonError("Something went wrong. Please try again.", 500);
}

/** Parses and validates pagination params, clamped to sane bounds. */
export function parsePagination(searchParams: URLSearchParams) {
  const rawPage = Number(searchParams.get("page") ?? "1");
  const rawPerPage = Number(searchParams.get("per_page") ?? "25");

  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const perPage =
    Number.isFinite(rawPerPage) && rawPerPage > 0 ? Math.min(Math.floor(rawPerPage), 100) : 25;

  return { page, perPage, from: (page - 1) * perPage, to: page * perPage - 1 };
}
