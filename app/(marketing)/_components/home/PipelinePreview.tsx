import { PIPELINE_PREVIEW } from "@/lib/marketing/home";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";

/**
 * "See your hiring pipeline at a glance." — the second product view.
 *
 * A TABLE, because the first product visual was a dashboard and showing the
 * same shape twice would waste the section. This is the Applications list: the
 * columns are the real ones, and "Next action" is genuinely computed in the
 * product (lib/evaluation/nextAction.ts) rather than invented for the picture.
 *
 * A REAL <table>, not a grid of divs. It is tabular data, the header cells are
 * <th scope="col">, and that is what makes it navigable rather than just
 * looking like a table. On a phone it scrolls horizontally inside its own
 * container — the one place the design system permits that — because collapsing
 * five columns into stacked cards would lose the at-a-glance comparison the
 * section is named after.
 */
export function PipelinePreview() {
  return (
    <Section tone="light" flush>
      <SectionHeading
        eyebrow="The pipeline"
        title="See your hiring pipeline at a glance."
        lead="Every candidate, their stage, their match against the role, and the one thing waiting to happen next."
      />

        <figure className="mkt-table">
          <div className="mkt-table__scroll">
            <table>
              <thead>
                <tr>
                  {PIPELINE_PREVIEW.columns.map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PIPELINE_PREVIEW.rows.map((row) => (
                  <tr key={row.name}>
                    <td className="mkt-table__name">{row.name}</td>
                    <td>{row.role}</td>
                    <td>
                      <span className="mkt-chip">{row.stage}</span>
                    </td>
                    <td>
                      {/*
                        The score as a number AND a meter. The meter alone would
                        carry the value in colour and length only; the number is
                        what makes it readable in greyscale and to a screen
                        reader, which is why the bar is aria-hidden.
                      */}
                      <span className="mkt-score">
                        <span className="mkt-score__num">{row.score}</span>
                        <span className="mkt-score__track" aria-hidden="true">
                          <span
                            className="mkt-score__bar"
                            style={{ width: `${row.score}%` }}
                          />
                        </span>
                      </span>
                    </td>
                    <td className="mkt-table__next">{row.next}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <figcaption className="mkt-product__caption">
            Example data, shown to illustrate the interface.
          </figcaption>
      </figure>
    </Section>
  );
}
