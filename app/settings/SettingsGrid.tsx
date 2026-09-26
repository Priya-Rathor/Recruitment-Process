"use client";

// =============================================================================
// The Setup directory: heading, search, and the grid of category cards.
//
// A client component ONLY because of the search box. The categories arrive
// already filtered by role from the server — nothing this component receives is
// hidden from the person viewing it, so there is no gating to leak. It cannot
// widen access; it can only hide things further.
//
// TWO VIEWS, NOT A SHRINKING GRID. With no query, the equal-size card grid.
// With one, a flat result list that names each match's category ("Agents ›
// Voice Interview Agent") — a filtered grid of equal-height cards would be
// mostly empty boxes, and would hide which category a lone match came from.
// =============================================================================

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight, Search, X } from "lucide-react";
import type { SettingsCategory, SettingsLink } from "./catalog";

/**
 * Match a query against a label.
 *
 * Subsequence matching rather than `includes`: "msgtmp" finds "Message
 * templates", and — the case that actually matters — a typed-through word like
 * "onbording" still finds "Onboarding documents". Plain substring search fails
 * both, and a settings search that fails on a typo sends people back to
 * scanning the grid, which is what the search was for.
 *
 * Deliberately NOT a scored fuzzy library: there are about thirty items.
 */
function matches(query: string, text: string): boolean {
  const needle = query.toLowerCase().replace(/\s+/g, "");
  if (needle.length === 0) return true;

  const haystack = text.toLowerCase();
  let at = 0;

  for (const character of needle) {
    at = haystack.indexOf(character, at);
    if (at === -1) return false;
    at += 1;
  }
  return true;
}

/**
 * Highlights the matched characters in a label.
 *
 * Walks the same subsequence `matches` found, so what is emphasised is exactly
 * what the search matched on. Without this, a subsequence hit looks arbitrary —
 * "why did typing 'msgtmp' return Message templates?" — and the feature reads as
 * broken rather than forgiving.
 */
function Highlighted({ text, query }: { text: string; query: string }) {
  const needle = query.toLowerCase().replace(/\s+/g, "");
  if (needle.length === 0) return <>{text}</>;

  // A contiguous hit first: "interview" should light up the word, not an "i"
  // three letters earlier. And nothing at all when the label did not match —
  // a result found by its description would otherwise show scattered letters.
  const hits = new Set<number>();
  const lower = text.toLowerCase();
  const contiguous = lower.indexOf(query.trim().toLowerCase());
  if (contiguous !== -1) {
    for (let index = 0; index < query.trim().length; index++) hits.add(contiguous + index);
  } else if (matches(query, text)) {
    let at = 0;
    for (const character of needle) {
      const found = lower.indexOf(character, at);
      hits.add(found);
      at = found + 1;
    }
  }

  return (
    <>
      {[...text].map((character, index) =>
        hits.has(index) ? (
          <mark key={index} className="settings-hit">
            {character}
          </mark>
        ) : (
          <span key={index}>{character}</span>
        )
      )}
    </>
  );
}

type Result = { category: string; link: SettingsLink };

/**
 * Every link the query finds, best first — Enter opens the first, so order is
 * behaviour, not decoration.
 *
 *   0. the words appear in the label or the category name ("agents" → the
 *      whole Agents card)
 *   1. the words appear in the description
 *   2. the letters appear in order in the label — typo tolerance
 *      ("onbording"), last because it also lets "agents" reach "Onboarding
 *      documents"
 *
 * Grid order within a tier. Subsequence is never tried on descriptions: across
 * a whole sentence it matches nearly anything.
 */
function search(categories: SettingsCategory[], query: string): Result[] {
  const words = query.toLowerCase();
  const ranked = categories.flatMap((category) => {
    const all = category.overview ? [...category.links, category.overview] : category.links;
    const inCategory = category.label.toLowerCase().includes(words);
    return all.flatMap((link) => {
      const tier =
        inCategory || link.label.toLowerCase().includes(words)
          ? 0
          : link.description.toLowerCase().includes(words)
            ? 1
            : matches(query, link.label)
              ? 2
              : null;
      return tier === null ? [] : [{ tier, result: { category: category.label, link } }];
    });
  });
  // Array.prototype.sort is stable, so grid order survives within a tier.
  return ranked.sort((a, b) => a.tier - b.tier).map((entry) => entry.result);
}

/**
 * The "leaves Settings" marker. It means leaves the SETTINGS AREA, not leaves
 * Scoreboad — a usability audit once read it as an external-site icon — so it
 * says so: a tooltip for pointer users and the same words for screen readers.
 */
function External() {
  return (
    <span className="settings-card__external" title="Opens outside Settings">
      <ArrowUpRight size={12} aria-hidden="true" />
      <span className="is-sr-only"> (opens outside Settings)</span>
    </span>
  );
}

export function SettingsGrid({ categories }: { categories: SettingsCategory[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const trimmed = query.trim();

  const results = useMemo(() => (trimmed ? search(categories, trimmed) : []), [categories, trimmed]);
  const total = categories.reduce(
    (count, category) => count + category.links.length + (category.overview ? 1 : 0),
    0
  );

  const clear = () => {
    setQuery("");
    input.current?.focus();
  };

  // Enter opens the first match; ArrowDown moves into the list; Escape clears.
  // The results are ordinary links, so Tab and Enter work on them unaided.
  const onInputKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && query) {
      event.preventDefault();
      clear();
    } else if (event.key === "Enter" && results[0]) {
      event.preventDefault();
      router.push(results[0].link.href);
    } else if (event.key === "ArrowDown" && results[0]) {
      event.preventDefault();
      list.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    }
  };

  const onListKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const links = [...(list.current?.querySelectorAll<HTMLAnchorElement>("a") ?? [])];
    const at = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (event.key === "Escape") {
      event.preventDefault();
      clear();
    } else if (event.key === "ArrowDown" && at < links.length - 1) {
      event.preventDefault();
      links[at + 1].focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      (at > 0 ? links[at - 1] : input.current)?.focus();
    }
  };

  return (
    <>
      <div className="settings-head">
        <h1 className="settings-head__title">Setup</h1>

        <div className="settings-search" role="search">
          <Search size={16} aria-hidden="true" className="settings-search__icon" />
          <input
            ref={input}
            className="input settings-search__input"
            // "search" rather than "text": on iOS it gets the right keyboard, and
            // screen readers announce it as a search.
            type="search"
            placeholder="Search settings…"
            aria-label="Search settings"
            aria-describedby="settings-count"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKey}
          />
          {trimmed.length > 0 && (
            <button type="button" className="settings-search__clear" aria-label="Clear search" onClick={clear}>
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/*
        Announced, not just rendered. Someone typing with a screen reader gets no
        feedback from a page silently changing behind them.
      */}
      <p id="settings-count" className="settings-count" role="status" aria-live="polite">
        {trimmed.length === 0
          ? `${total} settings in ${categories.length} categories`
          : results.length === 0
            ? `Nothing matches “${trimmed}”`
            : `${results.length} ${results.length === 1 ? "match" : "matches"} for “${trimmed}” — Enter opens the first`}
      </p>

      {trimmed.length === 0 ? (
        <div className="settings-grid">
          {categories.map((category) => (
            <section className="card settings-card" key={category.label} aria-labelledby={idFor(category.label)}>
              <h2 className="settings-card__title" id={idFor(category.label)}>
                {category.label}
              </h2>

              <ul className="settings-card__list">
                {category.links.map((link) => (
                  <li key={link.href}>
                    <Link className="settings-card__link" href={link.href}>
                      {link.label}
                      {link.external && <External />}
                    </Link>
                  </li>
                ))}
              </ul>

              {category.overview && (
                <Link className="settings-card__overview" href={category.overview.href}>
                  {category.overview.label}
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              )}
            </section>
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="card">
          <p style={{ fontSize: "var(--text-body)", marginBottom: "var(--space-3)" }}>
            No setting matches <strong>{trimmed}</strong>.
          </p>
          <button type="button" className="button is-small is-outlined-primary" onClick={clear}>
            Show everything
          </button>
        </div>
      ) : (
        <ul className="card settings-results" aria-label="Search results" ref={list} onKeyDown={onListKey}>
          {results.map(({ category, link }) => (
            <li key={link.href}>
              <Link className="settings-result" href={link.href}>
                <span className="settings-result__path">
                  <span className="settings-result__category">{category}</span>
                  <span aria-hidden="true"> › </span>
                  <span className="is-sr-only">: </span>
                  <span className="settings-result__label">
                    <Highlighted text={link.label} query={trimmed} />
                  </span>
                  {link.external && <External />}
                </span>
                <span className="settings-result__description">{link.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const idFor = (label: string) => `settings-cat-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
