"use client";

// =============================================================================
// Scroll-in reveal.
//
// ONE OBSERVER PER ELEMENT, unobserved the moment it fires. The alternative —
// a scroll listener recomputing offsets — runs on the main thread during the
// exact gesture it is decorating, which is how a landing page comes to feel
// slower than the page it replaced.
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
      rule catching it is worth keeping sharp. Same shape CandidatePicker uses.
    */
    if (typeof IntersectionObserver === "undefined") {
      const immediate = setTimeout(() => setShown(true), 0);
      return () => clearTimeout(immediate);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setShown(true);
        // Once revealed it stays revealed: re-animating on every scroll past is
        // the thing that makes these feel cheap.
        observer.disconnect();
      },
      // A little before the element arrives, so the fade completes as it lands
      // rather than starting once the reader is already looking at it.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.01 }
    );

    observer.observe(node);
    return () => observer.disconnect();
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
