"use client";

import { useRef } from "react";
import { ArrowRight } from "lucide-react";
import { ButtonLink } from "@/components/marketing/Button";

// =============================================================================
// A MAGNETIC PRIMARY CTA.
//
// The button leans a few pixels toward the pointer while it is over it, and
// returns when it leaves. Nothing else on the page does this, which is the
// point: the brief asks for magnetism "primarily for primary CTA buttons", and
// an effect every control has is not an emphasis.
//
// THE AMPLITUDE IS 4px. Past about six the button stops feeling attracted and
// starts feeling loose, and a control that moves away from where you aimed is
// a control you miss.
//
// A TRANSFORM WRITTEN TO THE NODE, not React state — a pointermove that
// re-rendered would be a re-render per frame for a decoration. The handler is
// gated on a real pointer and on reduced motion, so touch and
// motion-sensitive readers get an ordinary button with the site's usual
// hover lift.
//
// THE ICON IS IMPORTED HERE RATHER THAN PASSED IN, and that is a boundary
// rule rather than a preference. A lucide icon is a FUNCTION, and a server
// component cannot pass a function to a client one — the first version took
// `icon: LucideIcon` as a prop and the production build failed with
// "Functions cannot be passed directly to Client Components". Every magnetic
// CTA is a forward action, so a trailing arrow is the right fixed default
// and the boundary problem disappears with it.
// =============================================================================

const PULL_PX = 4;

export function MagneticCta({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  const move = (event: React.PointerEvent<HTMLSpanElement>) => {
    const node = ref.current;
    if (!node) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const box = node.getBoundingClientRect();
    const dx = ((event.clientX - (box.left + box.width / 2)) / (box.width / 2)) * PULL_PX;
    const dy = ((event.clientY - (box.top + box.height / 2)) / (box.height / 2)) * PULL_PX;
    node.style.setProperty("--pull-x", `${dx.toFixed(2)}px`);
    node.style.setProperty("--pull-y", `${dy.toFixed(2)}px`);
  };

  const reset = () => {
    const node = ref.current;
    if (!node) return;
    node.style.setProperty("--pull-x", "0px");
    node.style.setProperty("--pull-y", "0px");
  };

  return (
    <span
      className="mkt-magnetic"
      ref={ref}
      onPointerMove={move}
      onPointerLeave={reset}
      /*
        A presentational wrapper. The button inside keeps every bit of its own
        semantics — this element adds no role and takes no focus, so a keyboard
        or screen-reader user meets exactly the link they would have met
        without it.
      */
    >
      <ButtonLink href={href} variant="primary" icon={ArrowRight}>
        {children}
      </ButtonLink>
    </span>
  );
}
