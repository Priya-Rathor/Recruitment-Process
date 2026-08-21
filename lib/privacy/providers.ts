// =============================================================================
// §8 Data sharing and third-party services.
//
// What a candidate's voice call touches on its way through other companies'
// infrastructure, named plainly.
//
// THIS IS A DISCLOSURE SURFACE, NOT AN INTEGRATIONS SCREEN. /settings/integrations
// already exists and answers "is Bolna connected, and does the credential work".
// This answers a different question, and it is the question a data protection
// officer asks: which processors receive personal data, what data, and why. Under
// GDPR Art. 30 an organization has to be able to produce that list; this is the
// product handing it to them instead of making them reconstruct it from the
// codebase.
//
// NO CREDENTIALS, EVER — rule 2 of the brief, and it is structural here rather
// than a habit. Nothing in this file reads lib/integrations/store.ts, touches
// lib/integrations/crypto.ts, or takes an admin client. It cannot leak an API key
// because it never has one: the only thing it reads is whether a connection
// exists, which is a boolean.
//
// ONLY REAL PROVIDERS ARE LISTED. The brief's example names Sarvam AI for speech
// processing. There is no Sarvam adapter in lib/integrations/ — the speech half
// of a Bolna call is handled inside Bolna's own platform — so listing it would
// tell an organization it shares candidate voice data with a company it has no
// relationship with. That is a false statement in a compliance document, which is
// worse than an incomplete one. If a Sarvam adapter is added, it gets an entry
// here in the same commit.
// =============================================================================

/** Which of the brief's categories a processor falls into. */
export const PROCESSOR_CATEGORIES = ["telephony", "speech", "ai_model", "messaging"] as const;
export type ProcessorCategory = (typeof PROCESSOR_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ProcessorCategory, string> = {
  telephony: "Voice / telephony",
  speech: "Speech processing",
  ai_model: "AI model",
  messaging: "Candidate messaging",
};

export type Processor = {
  /** The integration key in lib/integrations/, where one exists. */
  key: "bolna" | "llm" | "email" | "whatsapp";
  name: string;
  category: ProcessorCategory;
  /** Why data goes there. One sentence. */
  purpose: string;
  /**
   * What personal data it receives. Enumerated rather than summarised, because
   * "call data" is not an answer a DPO can put in a register.
   */
  dataProcessed: string[];
  /**
   * Whether this processor receives data only when a specific setting is on.
   * Null means it is involved in every screening call.
   */
  conditionalOn: string | null;
};

/**
 * The processors this product actually sends candidate data to.
 *
 * Derived from the adapters that exist in lib/integrations/: bolna, llm, email
 * and whatsapp. Calendar is excluded — it receives interview times and
 * attendees, which is worth disclosing for interviews but is not part of the
 * voice-call path this section documents.
 */
export const PROCESSORS: Processor[] = [
  {
    key: "bolna",
    name: "Bolna",
    category: "telephony",
    purpose: "Places the outbound screening call and runs the voice conversation.",
    dataProcessed: [
      "Candidate phone number",
      "Candidate first name, as spoken in the greeting",
      "Job title, as spoken in the greeting",
      "The configured call script and questions",
      "Call metadata — start and end time, duration, outcome",
      "Call audio, and the transcript derived from it",
    ],
    conditionalOn: null,
  },
  {
    key: "llm",
    name: "The configured AI model provider",
    category: "ai_model",
    purpose:
      "Turns the call transcript into a structured screening report, and produces summaries and evaluations.",
    dataProcessed: [
      "Call transcript text",
      "The job's requirements and screening questions",
      "Candidate profile fields extracted from their resume",
    ],
    // Honest about the coupling: an organization that stores neither transcripts
    // nor evaluations has nothing to send to a model.
    conditionalOn: "Storing transcripts or AI evaluations",
  },
  {
    key: "email",
    name: "The configured email provider",
    category: "messaging",
    purpose: "Sends interview invitations, reminders and outcome messages to candidates.",
    dataProcessed: [
      "Candidate name and email address",
      "Interview time, place and joining details",
      "Message content from the configured template",
    ],
    conditionalOn: "Candidate email being enabled",
  },
  {
    key: "whatsapp",
    name: "The configured WhatsApp provider",
    category: "messaging",
    purpose: "Sends interview reminders to the candidate's phone.",
    dataProcessed: [
      "Candidate name and phone number",
      "Interview time and joining details",
      "Message content from the configured template",
    ],
    conditionalOn: "WhatsApp being enabled as a reminder channel",
  },
];

/**
 * One processor, plus whether this organization has actually connected it.
 *
 * `connected` comes from the adapters' own getStatus(), which returns a status
 * string and never a credential. A processor that is not connected receives
 * nothing, and saying so is the point: an organization reading this list needs to
 * distinguish "we share voice data with Bolna" from "we could, if we set it up".
 */
export type ProcessorDisclosure = Processor & {
  connected: boolean;
  /** Rendered instead of a bare boolean, so the UI has no logic in it. */
  statusLabel: string;
};

export function describeProcessors(
  connections: Partial<Record<Processor["key"], boolean>>
): ProcessorDisclosure[] {
  return PROCESSORS.map((processor) => {
    const connected = connections[processor.key] === true;

    return {
      ...processor,
      connected,
      statusLabel: connected
        ? "Connected — receiving data"
        : "Not connected — receiving no data",
    };
  });
}

/**
 * The processors currently receiving candidate data.
 *
 * The list an organization would put in a privacy notice or a processing
 * register. Excludes anything not connected, because a register listing
 * processors that receive nothing is padding, and padding in a compliance
 * document is how the real entries stop being read.
 */
export function activeProcessors(
  connections: Partial<Record<Processor["key"], boolean>>
): ProcessorDisclosure[] {
  return describeProcessors(connections).filter((processor) => processor.connected);
}
