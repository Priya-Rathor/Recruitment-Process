import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE CLIENT/SERVER IMPORT BOUNDARY, asserted.
 *
 * A `"use client"` component that imports a module which reaches
 * `lib/supabase/server.ts` pulls `next/headers` into the browser bundle, and the
 * App Router rejects the build. That is exactly the bug the cost header shipped
 * with: it imported three values from `lib/voice/cost.ts` — labels, a formatter, a
 * constant — and that file's other export reads the database.
 *
 * It is a nasty failure mode for two reasons. The import looks harmless (nobody
 * imports a formatter expecting to drag a database client along), and it can pass
 * a production build while failing the dev server, so it surfaces at the moment
 * somebody else pulls the branch.
 *
 * So it is a test rather than a convention. It walks the real files instead of
 * mocking anything: any client component, any depth of import chain.
 */

const ROOT = process.cwd();

/** Modules that must never end up in a browser bundle, and why. */
const SERVER_ONLY = [
  "@/lib/supabase/server",
  "@/lib/supabase/admin",
  "next/headers",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

const FILES = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "lib")), ...walk(path.join(ROOT, "components"))];

const SOURCE = new Map(FILES.map((file) => [file, readFileSync(file, "utf8")]));

function isClientComponent(source: string): boolean {
  // The directive has to be the first statement, so checking the head is enough.
  return /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\n|\s)*["']use client["']/.test(source);
}

/**
 * Import specifiers that survive to runtime.
 *
 * `import type { X } from "y"` is erased by the compiler and cannot pull anything
 * into a bundle, so it is skipped — that distinction IS the bug: the console's
 * type-only import of the same module was always fine, and the header's value
 * import was not.
 */
function runtimeImports(source: string): string[] {
  const found: string[] = [];
  const pattern = /^\s*import\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/gm;

  for (const match of source.matchAll(pattern)) {
    const isTypeOnly = Boolean(match[1]);
    if (isTypeOnly) continue;

    // `import { type A, type B }` — every named binding is a type, so nothing
    // survives. A mixed clause does survive and is checked.
    const clause = match[2] ?? "";
    const named = clause.match(/^\{([\s\S]*)\}$/);
    if (named) {
      const bindings = named[1]
        .split(",")
        .map((binding) => binding.trim())
        .filter((binding) => binding.length > 0);
      if (bindings.length > 0 && bindings.every((binding) => binding.startsWith("type "))) continue;
    }

    found.push(match[3]);
  }
  return found;
}

/** Resolves an "@/..." specifier to a file we have source for. */
function resolve(specifier: string, from: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(from), specifier);
  else return null;

  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (SOURCE.has(candidate)) return candidate;
  }
  return null;
}

/** Follows runtime imports from a client component, returning the first offence. */
function findServerReach(entry: string): string[] | null {
  const seen = new Set<string>();
  const stack: { file: string; trail: string[] }[] = [{ file: entry, trail: [entry] }];

  while (stack.length > 0) {
    const { file, trail } = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const source = SOURCE.get(file);
    if (!source) continue;

    for (const specifier of runtimeImports(source)) {
      if (SERVER_ONLY.includes(specifier)) {
        return [...trail, specifier];
      }
      const next = resolve(specifier, file);
      // A client component may import another client component; the chain is
      // followed regardless, because the boundary is about what the bundle ends
      // up containing, not about which file declared the directive.
      if (next) stack.push({ file: next, trail: [...trail, next] });
    }
  }
  return null;
}

describe("the client/server import boundary", () => {
  const clientComponents = FILES.filter((file) => isClientComponent(SOURCE.get(file) ?? ""));

  it("finds client components to check", () => {
    // Guards the guard: a broken directive matcher would make everything below
    // pass by checking nothing.
    expect(clientComponents.length).toBeGreaterThan(20);
  });

  it("keeps every client component clear of server-only modules", () => {
    const offences = clientComponents
      .map((file) => findServerReach(file))
      .filter((trail): trail is string[] => trail !== null)
      .map((trail) => trail.map((step) => path.relative(ROOT, step)).join("\n    → "));

    expect(offences).toEqual([]);
  });

  it("would catch the bug it was written for", () => {
    // lib/voice/cost.ts is the server half of the cost module. If a client
    // component ever imports it by value again, the check above must fail — so
    // prove the detector actually flags that chain.
    const trail = findServerReach(path.join(ROOT, "lib/voice/cost.ts"));
    expect(trail).not.toBeNull();
    expect(trail?.at(-1)).toBe("@/lib/supabase/server");
  });
});
