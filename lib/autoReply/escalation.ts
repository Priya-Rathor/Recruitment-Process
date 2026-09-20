// =============================================================================
// When the agent must NOT answer — decided without asking the model.
//
// PURE. No database, no AI. Client-safe, so the Settings page can explain the
// rule to the admin who is switching the agent on.
//
// WHY A DETERMINISTIC CHECK EXISTS AT ALL, GIVEN THE MODEL IS ALSO ASKED TO
// DECLINE.
//
// AGENTS.md: "where a model's output feeds an automated branch, require a
// deterministic signal to agree with it." Nothing else in this product sends a
// model's output to a real person unreviewed, so this is the one place that rule
// has teeth. The model is asked to escalate sensitive questions AND this runs
// independently; a confident answer requires BOTH to agree it is safe. Either
// one saying "escalate" escalates.
//
// That asymmetry is the design. A false escalation costs a recruiter thirty
// seconds. A false confident answer — telling somebody their salary expectation
// is fine, or that they are still being considered when they are not — cannot be
// unsent and may be the last thing this company ever says to them.
//
// WHAT THIS IS NOT. It is not a jailbreak filter and it is not trying to
// classify intent. It is a list of subjects a recruiter would not delegate to an
// assistant, matched conservatively on the candidate's own words.
// =============================================================================

export type EscalationTopic =
  | "compensation"
  | "contesting_outcome"
  | "distress"
  | "legal_or_immigration"
  | "personal_data_request";

export type EscalationSignal = {
  topic: EscalationTopic;
  /** For the flag shown to a recruiter. Never sent to the candidate. */
  label: string;
};

/**
 * Subjects the agent hands to a person, and the phrases that identify them.
 *
 * MATCHED AS WHOLE WORDS, and phrases are preferred over single words wherever a
 * single word would be ambiguous. "offer" is not here, even though it is
 * obviously compensation-adjacent, because "thanks for the offer" and "when is
 * the offer stage" are ordinary status questions the agent should answer. The
 * cost of a term being too broad is a permanently escalated inbox, which ends
 * with the feature switched off.
 */
const TOPIC_TERMS: Record<EscalationTopic, { label: string; terms: string[] }> = {
  compensation: {
    label: "Pay or negotiation",
    terms: [
      "salary",
      "ctc",
      "compensation",
      "package",
      "how much will i be paid",
      "how much does it pay",
      "pay scale",
      "negotiate",
      "negotiable",
      "counter offer",
      "counteroffer",
      "hike",
      "increment",
      "bonus",
      "equity",
      "esop",
      "notice period buyout",
      "relocation allowance",
    ],
  },
  contesting_outcome: {
    label: "Contesting a decision",
    terms: [
      "why was i rejected",
      "why did i get rejected",
      "why was i not selected",
      "why didn't i get",
      "why did you reject",
      "this is unfair",
      "reconsider",
      "appeal",
      "i disagree",
      "that's not right",
      "i deserve",
      "discriminat",
      "biased",
    ],
  },
  distress: {
    label: "Needs a person",
    terms: [
      "urgent",
      "emergency",
      "hospital",
      "passed away",
      "bereave",
      "funeral",
      "depress",
      "anxious",
      "desperate",
      "please help me",
      "i am struggling",
      "i'm struggling",
      "lost my job",
      "no money",
      "frustrated",
      "disappointed",
      "upset",
      "complaint",
      "complain",
    ],
  },
  legal_or_immigration: {
    label: "Legal or visa",
    terms: [
      "visa",
      "work permit",
      "sponsorship",
      "sponsor my",
      "h1b",
      "h-1b",
      "green card",
      "lawyer",
      "legal action",
      "solicitor",
      "contract terms",
      "notice period clause",
      "non compete",
      "non-compete",
      "bond",
    ],
  },
  personal_data_request: {
    label: "Data or privacy request",
    terms: [
      "delete my data",
      "delete my details",
      "remove my data",
      "erase my data",
      "gdpr",
      "dpdp",
      "right to be forgotten",
      "what data do you have",
      "data protection",
    ],
  },
};

/**
 * Subjects present in an inbound message.
 *
 * Substring matching on a normalised string rather than word boundaries, because
 * the terms above are chosen to be safe that way ("discriminat" catches
 * discriminate/discrimination/discriminatory) and because a phone keyboard
 * produces "salary?" and "SALARY" and "sal ary" — the first two of which this
 * catches and the third of which no list would.
 */
export function detectEscalationTopics(text: string): EscalationSignal[] {
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  const found: EscalationSignal[] = [];

  for (const [topic, definition] of Object.entries(TOPIC_TERMS) as [
    EscalationTopic,
    { label: string; terms: string[] },
  ][]) {
    if (definition.terms.some((term) => normalized.includes(term))) {
      found.push({ topic, label: definition.label });
    }
  }

  return found;
}

/** The holding message, when the agent declines to answer.
 *
 * ONE STRING, and deliberately not configurable. An organization that could
 * reword this could word it into a promise ("we'll call you within the hour"),
 * and the agent has no way to keep a promise. It says only what is true: the
 * message arrived, and a person will look at it.
 *
 * It does not apologise, name the AI, or explain the refusal. A candidate who
 * asked about salary does not need to be told a classifier fired; they need to
 * know a human has it.
 */
export const HOLDING_MESSAGE =
  "Thanks for your message — a member of our team will get back to you shortly.";

/**
 * Reasons a conversation gets flagged, in the words the inbox shows.
 *
 * Built here rather than in the runner so the phrasing is testable and cannot
 * drift between the immediate path and the sweep's delayed path.
 */
export function escalationReasonFrom(signals: EscalationSignal[]): string {
  if (signals.length === 0) return "The agent wasn't confident enough to answer.";

  const labels = signals.map((signal) => signal.label);
  const list =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;

  return `Mentions ${list.toLowerCase()} — the agent sent a holding reply instead.`;
}
