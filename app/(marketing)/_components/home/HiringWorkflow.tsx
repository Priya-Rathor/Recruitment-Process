import { WORKFLOW_STEPS } from "@/lib/marketing/home";
import { Reveal } from "./Reveal";

/**
 * "From application to hire" — six steps.
 *
 * HORIZONTAL ON DESKTOP, VERTICAL ON MOBILE, and the connector is drawn by CSS
 * rather than by an SVG path: a `::before` rule on the row and a pseudo-element
 * per step means the line follows the real layout at any width, including the
 * moment it turns vertical. An SVG would need two versions and a breakpoint to
 * choose between them.
 *
 * The step numbers are `aria-hidden` and the order is carried by the <ol>, so a
 * screen reader hears "1. Create a job" from the list semantics rather than
 * hearing "01" read out as a separate string.
 */
export function HiringWorkflow() {
  return (
    <section className="mkt-band mkt-band--light mkt-band--flush">
      <div className="mkt-shell">
        <div className="mkt-bandhead">
          <p className="mkt-eyebrow mkt-eyebrow--light">The flow</p>
          <h2>From application to hire.</h2>
          <p className="mkt-bandlead">
            One path through the process, with every stage writing to the same
            records.
          </p>
        </div>

        <ol className="mkt-flowline">
          {WORKFLOW_STEPS.map((step, index) => (
            <Reveal as="li" key={step.step} delay={index * 70} className="mkt-flowline__item">
              <span className="mkt-flowline__num" aria-hidden="true">
                {step.step}
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
