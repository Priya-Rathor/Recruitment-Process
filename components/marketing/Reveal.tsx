"use client";

// =============================================================================
// THE ANIMATION SYSTEM — scroll-in reveal, and a stagger for groups.
//
// MOVED HERE FROM THE HOME FOLDER because it is foundation rather than one
// page's helper: every marketing page built after this uses the same two
// primitives, and a second copy living beside a second page is how two pages
// come to fade at different speeds.
//
// ONE ANIMATION LANGUAGE, and these are it: opacity 0 -> 1 with a 14px lift,
// 520ms, on the shared easing curve. Everything else on the site is a CSS
// hover transition. There is deliberately no third mechanism.
//
// ONE OBSERVER FOR THE WHOLE PAGE, shared by every Reveal, with each element
// unobserved the moment it fires.
//
// THIS REPLACED ONE OBSERVER PER ELEMENT, and the measurement is why: the home
// page renders 66 Reveals, so it was constructing 66 IntersectionObservers —
// plus five more for the scroll-story sentinels — and handing the browser 71
// separate observation contexts to service on every scroll. One observer
// watching 66 targets is the same work for us and a fraction of it for the
// browser, because the options are identical for all of them and there was
// never a reason for more than one.
//
// The alternative to either — a scroll listener recomputing offsets — runs on
// the main thread during the exact gesture it is decorating, which is how a
// landing page comes to feel slower than the page it replaced.
//
// NO ANIMATION LIBRARY. The brief rules out heavy dependencies for decoration,
// and this is twelve lines of IntersectionObserver plus a CSS transition. Adding
// framer-motion to fade six cards in would ship ~40KB to do it.
//
// REDUCED MOTION IS HANDLED IN CSS, NOT HERE. The class is always applied; the
// stylesheet's `prefers-reduced-motion` block neutralises the transform and the
// transition. Doing it in JS would mean reading a media query during render,
// which differs between server and client and produces a hydration mismatch.
// =============================================================================

import { useEffect, useRef, useState, type ReactNode } from "react";

/*
  THE SHARED OBSERVER.

  Module scope, created lazily on the first Reveal that mounts and never torn
  down — a page always has more of these arriving, and an observer with nothing
  to watch costs nothing. Every Reveal uses identical options, which is exactly
  the condition under which one observer can serve all of them.

  The callbacks live in a Map keyed by the element. A WeakMap would be tidier
  for collection, but entries are deleted the moment they fire and on unmount,
  so nothing accumulates and a plain Map is iterable if this ever needs
  debugging.
*/
const REVEAL_OPTIONS: IntersectionObserverInit = {
  // A little before the element arrives, so the fade completes as it lands
  // rather than starting once the reader is already looking at it.
  rootMargin: "0px 0px -12% 0px",
  threshold: 0.01,
};

let sharedObserver: IntersectionObserver | null = null;
const pending = new Map<Element, () => void>();

function observeOnce(node: Element, onShow: () => void): () => void {
  sharedObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const fire = pending.get(entry.target);
      if (!fire) continue;
      // Deleted and unobserved BEFORE firing: once revealed it stays revealed,
      // and re-animating on every scroll past is the thing that makes these
      // feel cheap.
      pending.delete(entry.target);
      sharedObserver?.unobserve(entry.target);
      fire();
    }
  }, REVEAL_OPTIONS);

  pending.set(node, onShow);
  sharedObserver.observe(node);

  return () => {
    pending.delete(node);
    sharedObserver?.unobserve(node);
  };
}

export function Reveal({
  children,
  /** Stagger within a group, in ms. Kept small — this is a hint, not a show. */
  delay = 0,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "li" | "section";
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    /*
      No IntersectionObserver — an old browser, or a test environment — means
      show it immediately. A progressive enhancement that HIDES content when it
      fails is not an enhancement.

      Through a zero-delay timer rather than a direct call, so nothing is set
      synchronously in this effect body: that is a cascading render, and the lint
      rule catching it is worth keeping sharp.
    */
    if (typeof IntersectionObserver === "undefined") {
      const immediate = setTimeout(() => setShown(true), 0);
      return () => clearTimeout(immediate);
    }

    return observeOnce(node, () => setShown(true));
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={`mkt-reveal${shown ? " is-shown" : ""}${className ? ` ${className}` : ""}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}


/**
 * A group whose children reveal in sequence.
 *
 * WHY THIS EXISTS RATHER THAN A `delay` ON EACH CHILD. Staggering by hand means
 * every call site computing `index * 60`, and the moment a grid's order changes
 * the delays are wrong in a way nobody notices — the animation still runs, just
 * out of step. Here the sequence is a property of the group.
 *
 * THE STAGGER IS CAPPED. Eight cards at 60ms is 420ms of waiting for the last
 * one, which is already at the edge of feeling slow; a twelve-item grid at the
 * same step would take three-quarters of a second to finish arriving. Past the
 * cap the remaining children share the final delay, so a long list still lands
 * promptly.
 */
export function Stagger({
  children,
  step = 60,
  /** Beyond this many children the delay stops growing. */
  max = 6,
  className = "",
  as = "div",
}: {
  children: ReactNode[];
  step?: number;
  max?: number;
  className?: string;
  as?: "div" | "ul" | "ol";
}) {
  const Tag = as;

  return (
    <Tag className={className}>
      {children.map((child, index) => (
        <Reveal
          key={index}
          delay={Math.min(index, max) * step}
          as={as === "div" ? "div" : "li"}
        >
          {child}
        </Reveal>
      ))}
    </Tag>
  );
}
