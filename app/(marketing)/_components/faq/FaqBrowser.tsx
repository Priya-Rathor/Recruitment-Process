"use client";

// =============================================================================
// THE FAQ BROWSER — categories, search and the answers themselves.
//
// -----------------------------------------------------------------------------
// NATIVE <details>, NOT A HAND-BUILT ACCORDION
// -----------------------------------------------------------------------------
//
// The homepage FAQ has used <details>/<summary> since Module 01, and Step 1
// says to reuse rather than build a second system. It is also simply the better
// component: open and close, Enter AND Space, the expanded state exposed to
// assistive technology, and the whole thing works before any JavaScript runs.
// A hand-rolled version needs state, aria-expanded, aria-controls and a key
// handler to arrive back where the browser already was — and Step 8's "no
// clickable div used as a fake button" is free here rather than a thing to
// remember.
//
// MULTIPLE ANSWERS MAY BE OPEN AT ONCE. Deliberate, and the reason is that
// these questions are compared: certification against data handling, cost
// against trial. The `name` attribute would make the group exclusive and close
// one answer as you open the next, which is precisely wrong for that.
//
// -----------------------------------------------------------------------------
// WHY THIS IS A CLIENT COMPONENT AT ALL
// -----------------------------------------------------------------------------
//
// Only for the filtering. The answers are server-rendered inside it, so every
// question and every answer is in the HTML a crawler receives whatever the
// filter says — the filter hides rows, it does not fetch them.
// =============================================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Search, X } from "lucide-react";
import {
  FAQ_ITEMS,
  faqCategoriesInUse,
  type FaqCategoryKey,
} from "@/lib/marketing/faq";

type Filter = FaqCategoryKey | "all";

const CATEGORIES = faqCategoriesInUse();

export function FaqBrowser() {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return FAQ_ITEMS.filter((item) => {
      if (filter !== "all" && item.category !== filter) return false;
      if (needle.length === 0) return true;
      // Question AND answer, because somebody searching "SOC 2" is looking for
      // a phrase that only appears in an answer.
      return `${item.q} ${item.a}`.toLowerCase().includes(needle);
    });
  }, [filter, query]);

  const searching = query.trim().length > 0;

  return (
    <div className="faq-shell">
      {/* ---- Left: the sticky rail ------------------------------------- */}
      <div className="faq-rail">
        <div className="faq-rail__inner">
          <div className="faq-search">
            {/*
              A REAL LABEL, not a placeholder standing in for one. Visually
              hidden because the magnifier and the field's own placeholder make
              its purpose obvious on screen, but a placeholder disappears the
              moment you type and is not a label to a screen reader.
            */}
            <label htmlFor="faq-search" className="is-sr-only">
              Search the frequently asked questions
            </label>
            <span className="faq-search__icon" aria-hidden="true">
              <Search size={16} strokeWidth={1.7} />
            </span>
            <input
              id="faq-search"
              type="search"
              className="faq-search__input"
              placeholder="Search questions…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {searching && (
              <button
                type="button"
                className="faq-search__clear"
                onClick={() => setQuery("")}
              >
                <X size={15} aria-hidden="true" />
                <span className="is-sr-only">Clear the search</span>
              </button>
            )}
          </div>

          {/*
            The categories. Toggle buttons with `aria-pressed` rather than a
            tablist: a tab implies a panel per tab, and there is one list here
            that these narrow. `aria-pressed` is also the styling hook, so the
            pressed state a screen reader hears and the pill a sighted reader
            sees cannot drift apart.
          */}
          <nav className="faq-cats" aria-label="Filter questions by category">
            <button
              type="button"
              className="faq-cat"
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              All questions
              <span className="faq-cat__count">{FAQ_ITEMS.length}</span>
            </button>

            {CATEGORIES.map((category) => (
              <button
                key={category.key}
                type="button"
                className="faq-cat"
                aria-pressed={filter === category.key}
                onClick={() => setFilter(category.key)}
              >
                {category.label}
                <span className="faq-cat__count">
                  {FAQ_ITEMS.filter((item) => item.category === category.key).length}
                </span>
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* ---- Right: the answers ------------------------------------------ */}
      <div className="faq-main">
        {/*
          The result count, announced. Without it a screen-reader user typing
          into the search gets no feedback that anything changed — the list
          below simply becomes shorter somewhere off-screen.
        */}
        <p className="faq-count" aria-live="polite">
          {visible.length === 0
            ? "No questions found."
            : `${visible.length} ${visible.length === 1 ? "question" : "questions"}`}
        </p>

        {visible.length === 0 ? (
          <div className="faq-empty">
            <p className="faq-empty__title">No questions found.</p>
            <p className="faq-empty__body">
              Nothing here matches that. Clearing the search brings every
              question back.
            </p>
            <button
              type="button"
              className="mkt-btn mkt-btn--ghost"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              Show every question
            </button>
          </div>
        ) : (
          <div className="faq-list">
            {visible.map((item) => (
              <details key={item.id} id={item.id} className="faq-item">
                <summary className="faq-item__q">
                  {/*
                    THE QUESTION IS AN <h3>, INSIDE the summary.

                    Without it the page has an h1, an h2 and then thirty-one
                    questions that are not headings at all — so a screen-reader
                    user cannot navigate the FAQ by heading, which is the single
                    most common way of moving through a long page of them.

                    Inside rather than around: <summary> must be the first child
                    of <details>, so a heading cannot wrap it. The spec's content
                    model for <summary> is phrasing content "optionally
                    intermixed with heading content", so this is the arrangement
                    the format actually allows.
                  */}
                  <h3 className="faq-item__qtext">{item.q}</h3>
                  {/* CSS chevron: the native marker cannot be styled consistently. */}
                  <span className="faq-item__mark" aria-hidden="true" />
                </summary>

                <div className="faq-item__body">
                  <p className="faq-item__a">{item.a}</p>

                  {/*
                    STEP 6's PRODUCT VISUAL, and it is a sequence of real stage
                    names rather than a drawing of a screen. A mock interface
                    would have to invent controls to look convincing, which the
                    same step rules out; this says the same thing and cannot be
                    wrong about what the product does.
                  */}
                  {item.flow && (
                    <ol className="faq-flow">
                      {item.flow.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  )}

                  {item.links && (
                    <ul className="faq-item__links">
                      {item.links.map((link) => (
                        <li key={link.href}>
                          <Link href={link.href}>
                            {link.label}
                            <ArrowRight size={14} aria-hidden="true" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
