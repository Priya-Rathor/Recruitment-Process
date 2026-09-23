import { describe, expect, it } from "vitest";
import {
  CONTACT_CTA,
  CONTACT_FIELDS,
  CONTACT_FORM_NOTICE,
  CONTACT_HERO,
  CONTACT_LIMITS,
  CONTACT_NEXT,
  CONTACT_PRIVACY_NOTE,
  CONTACT_PRODUCT,
  CONTACT_TRUST,
  EMPTY_CONTACT,
  validateContact,
  type ContactValues,
} from "./contact";
import { INTERNAL_ROUTES } from "./content";

/**
 * The Contact page's integrity.
 *
 * WHAT MAKES THIS PAGE DIFFERENT FROM THE REST OF THE SITE: it is the one page
 * whose whole job is to invite a message, and there is nowhere for a message to
 * go. Every other page can be honest by leaving something out; this one has to
 * be honest about the thing it is for.
 *
 * So the tests below fall into two halves — the validator, which is ordinary
 * logic, and the guards that stop a future edit quietly turning a form that
 * cannot send into one that claims it did.
 */

const filled = (over: Partial<ContactValues> = {}): ContactValues => ({
  name: "Priya R",
  email: "priya@example.com",
  company: "Example Ltd",
  role: "Head of Talent",
  message: "We hire backend engineers and want to see how screening works.",
  ...over,
});

describe("validateContact", () => {
  it("accepts a complete, sensible submission", () => {
    expect(validateContact(filled())).toEqual({});
  });

  it("accepts one with the optional fields empty", () => {
    expect(validateContact(filled({ company: "", role: "" }))).toEqual({});
  });

  it("requires a name, an email and a message", () => {
    const errors = validateContact(EMPTY_CONTACT);
    expect(errors.name).toBeTruthy();
    expect(errors.email).toBeTruthy();
    expect(errors.message).toBeTruthy();
    // And does NOT invent problems with the optional ones.
    expect(errors.company).toBeUndefined();
    expect(errors.role).toBeUndefined();
  });

  it("treats whitespace as empty", () => {
    // "   " is not a name. Trimming at validation time is what stops a blank
    // submission passing a `length > 0` check.
    const errors = validateContact(filled({ name: "   ", message: "  \n  " }));
    expect(errors.name).toBeTruthy();
    expect(errors.message).toBeTruthy();
  });

  it.each([
    "not-an-email",
    "missing@domain",
    "@example.com",
    "two @spaces.com",
    "trailing@dot.",
  ])("rejects %s as an email", (email) => {
    expect(validateContact(filled({ email })).email).toBeTruthy();
  });

  it.each(["a@b.co", "first.last+tag@sub.example.com"])("accepts %s", (email) => {
    expect(validateContact(filled({ email })).email).toBeUndefined();
  });

  it("rejects a message that is too short to act on", () => {
    expect(validateContact(filled({ message: "hi" })).message).toBeTruthy();
  });

  it("bounds every field, so a paste cannot be unbounded", () => {
    const long = "x".repeat(5000);
    const errors = validateContact({
      name: long,
      email: `${"x".repeat(200)}@example.com`,
      company: long,
      role: long,
      message: long,
    });
    expect(errors.name).toBeTruthy();
    expect(errors.email).toBeTruthy();
    expect(errors.company).toBeTruthy();
    expect(errors.role).toBeTruthy();
    expect(errors.message).toBeTruthy();
  });

  it("accepts a message exactly at each boundary", () => {
    // Off-by-one at a limit is the classic way a valid submission gets refused.
    expect(
      validateContact(filled({ message: "x".repeat(CONTACT_LIMITS.messageMin) })).message
    ).toBeUndefined();
    expect(
      validateContact(filled({ message: "x".repeat(CONTACT_LIMITS.messageMax) })).message
    ).toBeUndefined();
    expect(
      validateContact(filled({ message: "x".repeat(CONTACT_LIMITS.messageMax + 1) })).message
    ).toBeTruthy();
  });

  it("is pure — it does not mutate what it is given", () => {
    const values = filled();
    const copy = { ...values };
    validateContact(values);
    expect(values).toEqual(copy);
  });
});

describe("the form asks for nothing it should not", () => {
  it("requests no phone number, candidate data, resume or password", () => {
    /*
      §5 rules these out, and the reason is worth keeping: this form has no
      backend, so anything typed into it is personal data collected for no
      purpose — and candidate details would be somebody ELSE's personal data,
      collected by a third party, on a page that cannot store it lawfully or
      otherwise.
    */
    const names = CONTACT_FIELDS.map((f) => f.name.toLowerCase());
    const labels = CONTACT_FIELDS.map((f) => f.label.toLowerCase());

    for (const banned of ["phone", "mobile", "password", "resume", "cv", "candidate", "salary"]) {
      expect(names.some((n) => n.includes(banned)), `field name: ${banned}`).toBe(false);
      expect(labels.some((l) => l.includes(banned)), `field label: ${banned}`).toBe(false);
    }
  });

  it("stays short", () => {
    // Five fields. A contact form that grows into a qualification questionnaire
    // is the thing §5 is guarding against.
    expect(CONTACT_FIELDS.length).toBeLessThanOrEqual(6);
  });

  it("gives every field a label and every text field an autocomplete token", () => {
    for (const field of CONTACT_FIELDS) {
      expect(field.label.trim().length).toBeGreaterThan(0);
      // §23: a textarea for free prose has no meaningful autocomplete token,
      // but every identity field does.
      if (field.type !== "textarea") {
        expect(field.autoComplete, `${field.name} has no autocomplete`).toBeTruthy();
      }
    }
  });

  it("asks the message field not to include candidate details", () => {
    const message = CONTACT_FIELDS.find((f) => f.name === "message");
    expect(message?.hint).toMatch(/no candidate details/i);
  });
});

describe("nothing here promises a reply", () => {
  const ALL_COPY: string[] = [
    CONTACT_HERO.title,
    CONTACT_HERO.lead,
    ...CONTACT_HERO.flow.flatMap((f) => [f.label, f.note]),
    ...CONTACT_HERO.nodes,
    CONTACT_CTA.primary.label,
    CONTACT_CTA.secondary.label,
    CONTACT_FORM_NOTICE.title,
    CONTACT_FORM_NOTICE.body,
    ...CONTACT_FIELDS.flatMap((f) => [f.label, f.hint ?? ""]),
    ...CONTACT_NEXT.flatMap((s) => [s.label, s.body]),
    ...CONTACT_PRODUCT.flatMap((p) => [p.label, p.note]),
    ...CONTACT_TRUST,
    CONTACT_PRIVACY_NOTE,
  ];

  it("invents no address, phone number or booking link", () => {
    /*
      §12 AND §11 IN ONE ASSERTION. There is no sales address, no support
      address, no Calendly and no Cal.com anywhere in this project. Each of
      these is a single careless line away from appearing on a contact page,
      and each would send a real person somewhere that does not answer.
    */
    const banned = [
      /[\w.+-]+@[\w-]+\.[\w.]{2,}/,          // any email address
      /calendly|cal\.com|hubspot|savvycal|chilipiper/i,
      /\+?\d[\d\s()-]{7,}\d/,                 // anything phone-shaped
      /\bWhatsApp\b|\bIntercom\b|\blive chat\b/i,
    ];

    const offenders: string[] = [];
    for (const line of ALL_COPY) {
      for (const pattern of banned) {
        if (pattern.test(line)) offenders.push(`${String(pattern)} → "${line}"`);
      }
    }

    expect(offenders, `invented contact channel:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("promises no response time and no scheduled demo", () => {
    const banned = [
      /\bwithin \d+\s*(minutes?|hours?|business days?|days?)\b/i,
      /\bwe(?:'ll| will)\s+(get back|respond|reply|reach out|be in touch)\b/i,
      /\b\d+[- ]minute (demo|call)\b/i,
      /\bbook a (demo|call|meeting)\b/i,
      /\bschedule a (demo|call|meeting)\b/i,
      /\bpersonalised onboarding|personalized onboarding\b/i,
      /\bour team will\b/i,
    ];

    const offenders: string[] = [];
    for (const line of ALL_COPY) {
      for (const pattern of banned) {
        if (pattern.test(line)) offenders.push(`${String(pattern)} → "${line}"`);
      }
    }

    expect(offenders, `unbacked promise:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("never says a message was sent or received", () => {
    /*
      THE ONE THAT MATTERS MOST. §9 permits a success message only when the
      backend confirms delivery; there is no backend, so these words may not
      appear in the page's content at all.
    */
    const banned = [
      /\bmessage (has been |was )?(sent|received)\b/i,
      /\bwe(?:'ve| have) received\b/i,
      /\bthanks?[,—-]? (your|we)\b/i,
      /\bsubmitted successfully\b/i,
    ];

    for (const line of ALL_COPY) {
      for (const pattern of banned) {
        expect(pattern.test(line), `claims delivery: "${line}"`).toBe(false);
      }
    }
  });

  it("says plainly, before the fields, that the form does not send", () => {
    // The notice is what makes the rest of the page honest. If it is ever
    // removed, the form becomes a trap and this test is the alarm.
    expect(CONTACT_FORM_NOTICE.title).toMatch(/does not send/i);
    expect(CONTACT_FORM_NOTICE.body).toMatch(/no inbox|nothing here would reach/i);
  });

  it("tells the reader what happens to what they typed", () => {
    // §22, and it describes reality rather than reciting a consent formula for
    // a transfer that never happens.
    expect(CONTACT_PRIVACY_NOTE).toMatch(/nothing you type .*(sent|stored)|not sent|not stored/i);
  });

  it("names no customer, count or rating", () => {
    for (const line of ALL_COPY) {
      expect(
        /\btrusted by\b|\bjoin \d+|\b\d+\+? (companies|teams|customers)\b|\b\d\.\d\s*\/\s*5\b/i.test(line),
        line
      ).toBe(false);
    }
  });
});

describe("the page's routes", () => {
  it("points every link at a route that exists", () => {
    const known = new Set(INTERNAL_ROUTES);
    const hrefs = [
      CONTACT_CTA.primary.href,
      CONTACT_CTA.secondary.href,
      ...CONTACT_PRODUCT.map((p) => p.href),
    ];

    for (const href of hrefs) {
      const path = href.split("#")[0] || "/";
      expect(known.has(path), `${href} is not a real route`).toBe(true);
    }
  });

  it("makes the working route the primary action", () => {
    /*
      §4 — ONE primary action, and signup is the only one of the three
      candidates ("Book a Demo" / "Get Started" / "Talk to the Team") that this
      product can actually honour.
    */
    expect(CONTACT_CTA.primary.href).toBe("/signup");
    expect(CONTACT_CTA.primary.href).not.toBe(CONTACT_CTA.secondary.href);
  });

  it("is itself a route the site knows about", () => {
    expect(INTERNAL_ROUTES).toContain("/contact");
  });

  it("describes the real onboarding sequence", () => {
    // Three steps the visitor performs themselves — not a sales pipeline.
    expect(CONTACT_NEXT).toHaveLength(3);
    expect(CONTACT_NEXT[0].label).toMatch(/create an account/i);
  });
});
