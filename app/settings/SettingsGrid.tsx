"use client";

// =============================================================================
// The settings landing grid, with search.
//
// A client component ONLY because of the search box. The categories arrive
// already filtered by role from the server — nothing this component receives is
// hidden from the person viewing it, so there is no gating to leak. It cannot
// widen access; it can only hide things further.
// =============================================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Search, X } from "lucide-react";
import type { SettingsCategory } from "./catalog";

/**
 * Match a query against a label.
 *
 * Subsequence matching rather than `includes`: "msgtmp" finds "Message
 * templates", and — the case that actually matters — a typed-through word like
 * "onbording" still finds "Onboarding documents". Plain substring search fails
 * both, and a settings search that fails on a typo sends people back to
 * scanning the grid, which is what the search was for.
 *
 * Deliberately NOT a scored fuzzy library. There are eighteen items; ranking
 * them adds a dependency and a reordering animation to solve a problem this size
 * does not have. Order stays stable, non-matches simply go away.
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

  const hits = new Set<number>();
  let at = 0;

  for (const character of needle) {
    const found = text.toLowerCase().indexOf(character, at);
    if (found === -1) break;
    hits.add(found);
    at = found + 1;
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

export function SettingsGrid({ categories }: { categories: SettingsCategory[] }) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();

  /**
   * Filtering, with one deliberate rule: a category whose NAME matches keeps all
   * of its links.
   *
   * Typing "integrations" should show what is in Integrations, not an empty card
   * with a matching title. The alternative — requiring every link to match too —
   * would make searching by category useless, which is half of what people type.
   */
  const results = useMemo(() => {
    if (trimmed.length === 0) return categories;

    return categories
      .map((category) => {
        if (matches(trimmed, category.label)) return category;
        return {
          label: category.label,
          links: category.links.filter(
            (link) => matches(trimmed, link.label) || matches(trimmed, link.description)
          ),
        };
      })
      .filter((category) => category.links.length > 0);
  }, [categories, trimmed]);

  const total = results.reduce((count, category) => count + category.links.length, 0);

  return (
    <>
      <div className="settings-search">
        <Search size={16} aria-hidden="true" className="settings-search__icon" />
        <input
          className="input settings-search__input"
          type="search"
          // "search" rather than "text": on iOS it gets the right keyboard and a
          // native clear affordance, and screen readers announce it as a search.
          placeholder="Search settings…"
          aria-label="Search settings"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {trimmed.length > 0 && (
          <button
            type="button"
            className="settings-search__clear"
            aria-label="Clear search"
            onClick={() => setQuery("")}
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      {/*
        Announced, not just rendered. Someone typing into the box with a screen
        reader gets no feedback from a grid silently shrinking behind them.
      */}
      <p className="settings-count" role="status" aria-live="polite">
        {trimmed.length === 0
          ? `${total} settings in ${results.length} categories`
          : total === 0
            ? `Nothing matches “${trimmed}”`
            : `${total} ${total === 1 ? "match" : "matches"} for “${trimmed}”`}
      </p>

      {total === 0 ? (
        <div className="card">
          <p style={{ fontSize: "var(--text-body)", marginBottom: "var(--space-3)" }}>
            No setting matches <strong>{trimmed}</strong>.
          </p>
          <button type="button" className="button is-small is-outlined-primary" onClick={() => setQuery("")}>
            Show everything
          </button>
        </div>
      ) : (
        <div className="settings-grid">
          {results.map((category) => (
            <section className="card settings-card" key={category.label}>
              <h2 className="settings-card__title">
                <Highlighted text={category.label} query={trimmed} />
              </h2>

              <ul className="settings-card__list">
                {category.links.map((link) => (
                  <li key={link.href}>
                    <Link className="settings-card__link" href={link.href}>
                      <span className="settings-card__label">
                        <Highlighted text={link.label} query={trimmed} />
                        {/*
                          Marks a link that leaves the settings area — the audit
                          log and analytics are full product pages with their own
                          shell and no "back to Settings". Better to say so than
                          to let someone wonder where Settings went.
                        */}
                        {link.external && (
                          <ArrowUpRight
                            size={12}
                            aria-hidden="true"
                            className="settings-card__external"
                          />
                        )}
                      </span>
                      <span className="settings-card__description">{link.description}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
