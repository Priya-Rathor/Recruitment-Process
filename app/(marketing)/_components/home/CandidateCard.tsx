// =============================================================================
// THE CANDIDATE CARD — the page's protagonist, as a reusable object.
//
// A SERVER COMPONENT TAKING PLAIN PROPS, which is what makes it reusable in the
// sense the brief means. The hiring-pipeline module will want the same card
// moving between stage columns, and the closing CTA may want one; neither
// should have to inherit this section's scroll state to get it. So the card
// knows nothing about stages, timelines or selection — it is told a name, a
// role and a set of chips, and it draws them.
//
// THE CHIPS ARE THE STATE. The same card renders "Applied" on the left of the
// section and "Needs Review · 91/100" by the end of it, and that is the whole
// trick of the candidate appearing to travel: one object, changing labels, in
// a fixed position the reader's eye can hold on to.
//
// `tone` IS NEVER THE ONLY SIGNAL. Each chip carries its own words; the tint
// only ranks them.
// =============================================================================

export type CandidateChip = {
  label: string;
  value: string;
  tone?: "good" | "warn" | "neutral";
};

export function CandidateCard({
  name,
  role,
  chips,
  /** Marks the card as the one currently being read about. */
  active = false,
}: {
  name: string;
  role: string;
  chips: CandidateChip[];
  active?: boolean;
}) {
  return (
    <article className="cw-card" data-active={active || undefined}>
      <div className="cw-card__head">
        {/*
          INITIALS, NOT A PHOTOGRAPH. There is no real person here, and a stock
          headshot standing in for a candidate is the exact shape of thing this
          site has avoided everywhere else — it reads as a customer when it is
          an illustration. The initials are derived from the name so the card
          cannot fall out of step with itself.
        */}
        <span className="cw-card__avatar" aria-hidden="true">
          {name
            .split(/[\s.]+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0])
            .join("")}
        </span>

        <span className="cw-card__who">
          <strong>{name}</strong>
          <span>{role}</span>
        </span>
      </div>

      <dl className="cw-card__chips">
        {chips.map((chip) => (
          <div key={chip.label} className="cw-card__chip" data-tone={chip.tone}>
            <dt>{chip.label}</dt>
            <dd>{chip.value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
