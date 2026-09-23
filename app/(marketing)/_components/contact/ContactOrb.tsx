// =============================================================================
// THE CONTACT VISUAL — your team, through Scoreboad, into a connected workflow.
//
// A SERVER COMPONENT. CSS keyframes on server-rendered markup: no client
// JavaScript, and the un-animated rendering is the finished picture, so reduced
// motion and a failed script both get something complete. Same construction as
// the security page's orb, for the same reason.
//
// IT IS NOT WIRED TO THE FORM. §15 sketches the form emitting a signal that
// lights the orb, which would mean lifting the form's state into a parent so a
// decoration could read it — coupling the one interactive thing on the page to
// an ornament. The nodes resolve on arrival instead, the form stays the focus,
// and nothing on this page animates continuously.
//
// aria-hidden: the same three beats are an ordered list in the hero copy, and
// the four node labels are the product surfaces the page links to further down.
// A screen reader gets both in sentences rather than as loose words.
// =============================================================================

import { CONTACT_HERO } from "@/lib/marketing/contact";

export function ContactOrb() {
  return (
    <div className="ct-orb" aria-hidden="true">
      <span className="ct-orb__glow" />

      <div className="ct-orb__frame">
        {CONTACT_HERO.flow.map((beat, index) => (
          <div key={beat.label} className="ct-orb__beat" style={{ "--i": index } as React.CSSProperties}>
            <span className="ct-orb__beatlabel">{beat.label}</span>
            {index < CONTACT_HERO.flow.length - 1 && (
              <span className="ct-orb__link">
                <svg viewBox="0 0 8 18" width="8" height="18" focusable="false">
                  <path
                    d="M4 0v12m0 0l-3-3m3 3l3-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            )}
          </div>
        ))}
      </div>

      {/* The workflow the last beat resolves into. */}
      <ul className="ct-orb__nodes">
        {CONTACT_HERO.nodes.map((node, index) => (
          <li key={node} style={{ "--i": index } as React.CSSProperties}>
            {node}
          </li>
        ))}
      </ul>
    </div>
  );
}
