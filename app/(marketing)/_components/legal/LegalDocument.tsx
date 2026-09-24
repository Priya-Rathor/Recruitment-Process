import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Breadcrumbs } from "@/components/marketing/Breadcrumbs";
import { LEGAL_REVIEW_NOTICE, type LegalBlock, type LegalDoc } from "@/lib/marketing/legal";
import { LegalToc } from "./LegalToc";

/**
 * The shared renderer for all three legal documents.
 *
 * ONE COMPONENT, THREE PAGES. Privacy, Terms and Cookies differ only in their
 * content, so each route is a few lines that hand this a `LegalDoc`. Three
 * near-identical page files is how the table of contents ends up working on two
 * of them.
 *
 * A SERVER COMPONENT, and the mobile table of contents is a native <details> —
 * so the whole document, including every heading link, ships with no JavaScript
 * at all. A legal page is the last thing that should depend on a bundle loading.
 *
 * §19 — the content column is capped at a reading measure rather than the
 * shell's full width. Legal text at 1180px is the single most common reason
 * nobody reads it.
 */
export function LegalDocument({ doc }: { doc: LegalDoc }) {
  return (
    <>
      <section className="mkt-band mkt-band--dark lg-hero" aria-labelledby="legal-heading">
        <div className="mkt-shell">
          <Breadcrumbs
            items={[
              { label: "Home", href: "/" },
              { label: doc.title.replace(/\.$/, ""), href: `/${doc.slug}` },
            ]}
          />

          <h1 id="legal-heading" className="lg-hero__title">
            {doc.title}
          </h1>
          <p className="lg-hero__lead">{doc.lead}</p>
          <p className="lg-hero__updated">
            Last updated: <Marked text={doc.updated} />
          </p>
        </div>
      </section>

      <section className="mkt-band mkt-band--light lg-body">
        <div className="mkt-shell lg-shell">
          {/*
            §18's contents. The only client component on the page — it decides
            whether the disclosure starts open from a media query, because
            thirteen links expanded on a phone is the navigation wall the step
            rules out, and CSS cannot reliably force a closed <details> open.
          */}
          <LegalToc sections={doc.sections} />

          <div className="lg-doc">
            {/*
              §33's notice, above the first section rather than in a footnote.
              A reader who mistakes an unreviewed document for a reviewed one has
              been misled by where it sits as much as by what it says.
            */}
            <p className="lg-review" role="note">
              {LEGAL_REVIEW_NOTICE}
            </p>

            {doc.sections.map((section) => (
              <section key={section.id} id={section.id} className="lg-section">
                <h2>{section.title}</h2>
                {section.blocks.map((block, index) => (
                  <Block key={index} block={block} />
                ))}
              </section>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function Block({ block }: { block: LegalBlock }) {
  if (block.kind === "p") {
    return (
      <p className="lg-p">
        <Marked text={block.text} />
      </p>
    );
  }

  if (block.kind === "list") {
    return (
      <ul className="lg-list">
        {block.items.map((item) => (
          <li key={item}>
            <Marked text={item} />
          </li>
        ))}
      </ul>
    );
  }

  if (block.kind === "table") {
    /*
      A REAL <table>, with a header row and scope on its cells. These are
      genuinely tabular — a category and what it means — and a definition list
      would lose the column headings that make the pairing legible.
    */
    return (
      <div className="lg-tablewrap">
        <table className="lg-table">
          <thead>
            <tr>
              <th scope="col">{block.head[0]}</th>
              <th scope="col">{block.head[1]}</th>
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row[0]}>
                <th scope="row">
                  <Marked text={row[0]} />
                </th>
                <td>
                  <Marked text={row[1]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (block.kind === "link") {
    return (
      <p className="lg-p">
        <Marked text={block.text} />{" "}
        <Link href={block.href} className="lg-link">
          {block.label}
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </p>
    );
  }

  /*
    A NOTE, and it is styled to be read rather than skimmed past. Every one of
    these carries something a reader would rather know than not: a gap, a
    limitation, or a statement that something is not claimed. Setting them in
    small grey type would be the exact opposite of the point.
  */
  return (
    <p className="lg-note">
      <Marked text={block.text} />
    </p>
  );
}

/**
 * Renders `{{LIKE THIS}}` as a visually unmissable marker.
 *
 * §3 and §31: an unfinished legal value must never be mistakeable for a
 * finalised one. So it is not merely left blank and not filled with a plausible
 * guess — it is highlighted, kept in capitals, and labelled for a screen reader
 * as unfinished, because a marker that only reads as a marker visually is no
 * marker at all to somebody listening to the page.
 */
function Marked({ text }: { text: string }) {
  const parts = text.split(/(\{\{[^}]+\}\})/g);

  return (
    <>
      {parts.map((part, index) => {
        const match = part.match(/^\{\{([^}]+)\}\}$/);
        if (!match) return <span key={index}>{part}</span>;

        return (
          <mark key={index} className="lg-todo">
            <span className="is-sr-only">Unfinished: </span>
            {match[1]}
          </mark>
        );
      })}
    </>
  );
}
