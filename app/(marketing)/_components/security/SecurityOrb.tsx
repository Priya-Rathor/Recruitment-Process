// =============================================================================
// THE HERO DIAGRAM — controlled data paths into the workspace, and out to a
// person.
//
// PURE CSS AND SVG, NO CLIENT COMPONENT. The animation is keyframes on elements
// that are already in the DOM, so this renders as a server component, ships no
// JavaScript, and its final state is the same picture the animation ends on.
// That last part is the whole reason it is built this way: §29 requires the
// diagram to survive `prefers-reduced-motion`, and the cheapest way to
// guarantee that is for the animation to be a decoration ON a correct static
// drawing rather than the thing that assembles it.
//
// WHAT IT DELIBERATELY IS NOT. No padlocks, no shields, no binary rain, no
// hooded figure. The subject is a hiring workspace, and the security idea being
// drawn is that data arrives along a known path and leaves toward a named
// person — which is a diagram about flow, not about threat.
//
// THE TEXT EQUIVALENT (§28) is not in this file. The three beats are rendered
// as an ordered list by <SecurityHero>, and this whole drawing is aria-hidden,
// so a screen reader gets the sentence rather than a pile of unlabelled nodes.
// =============================================================================

export function SecurityOrb() {
  return (
    <div className="sec-orb" aria-hidden="true">
      <span className="sec-orb__glow" />

      {/*
        The inbound cards. Three, because three is enough to read as "several"
        while still letting each one keep a legible label at 320px.
      */}
      <ul className="sec-orb__feed">
        {["Application", "Resume", "Screening"].map((label, index) => (
          <li key={label} className="sec-orb__card" style={{ "--i": index } as React.CSSProperties}>
            {label}
          </li>
        ))}
      </ul>

      {/* The boundary that forms around the workspace. */}
      <span className="sec-orb__ring" />

      <div className="sec-orb__core">
        <span className="sec-orb__corelabel">Scoreboad</span>
        <span className="sec-orb__corenote">Session · role · workspace</span>
      </div>

      {/*
        The validation checkpoint, between the workspace and the person. It is a
        separate mark rather than a step in the ring because that is what it is
        in the product: output is checked in code before a human is shown it.
      */}
      <span className="sec-orb__check">
        <svg viewBox="0 0 16 16" width="13" height="13" focusable="false">
          <path
            d="M3.5 8.5l3 3 6-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Validated
      </span>

      <span className="sec-orb__out">Human review</span>
    </div>
  );
}
