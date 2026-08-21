// =============================================================================
// §2 Candidate consent and §7 AI processing disclosure.
//
// This is the layer that turns configuration into what the agent actually says,
// and turns what the candidate said back into a decision.
//
// THREE DIFFERENT THINGS THAT ARE EASY TO CONFLATE, kept separate on purpose —
// rule 4 of the brief asks for exactly this distinction:
//
//   1. THE DISCLOSURE. "This call is automated and may be recorded." Always
//      said. Not configurable. Lives in lib/screening/script.ts.
//   2. THE CONSENT GATE. Whether the agent stops and waits for an explicit yes
//      before continuing. Configurable (consent.requireExplicitConsent).
//   3. THE AI-PROCESSING DISCLOSURE. That responses are analysed automatically
//      to produce insights, and that a human reviews the outcome. A separate
//      fact from (1), and configurable (aiDisclosure.enabled).
//
// Switching (2) and (3) off does not make a call covert: the candidate is still
// told it is automated and may be recorded, and still free to refuse. What it
// changes is whether the agent halts for a spoken "yes" and whether it explains
// the analysis. Those are lawful configuration choices in one-party-consent
// jurisdictions, and they are the organization's to make.
// =============================================================================

import type { ScriptSegment } from "@/lib/screening/script";
import { isConsentRefusal } from "@/lib/screening/script";
import type { PrivacySettings } from "./settings";
import { resolveDataCollection } from "./settings";
import type { RetainableArtifact } from "./retention";

/**
 * The extra segments the privacy configuration contributes to a call script.
 *
 * Ordered to be said AFTER the mandatory disclosure and BEFORE the questions.
 * The disclosure has to come first for the reason script.ts documents at length,
 * and the AI-processing notice has to precede any question whose answer would be
 * analysed — telling somebody how their words will be used after they have
 * already said them is not a disclosure, it is a summary.
 */
export function buildPrivacySegments(settings: PrivacySettings): ScriptSegment[] {
  const segments: ScriptSegment[] = [];

  if (settings.aiDisclosure.enabled) {
    const message = settings.aiDisclosure.message.trim();
    if (message.length > 0) {
      segments.push({
        kind: "briefing",
        text: message,
        // A statement, not a question. The consent segment already captured the
        // candidate's answer; asking twice makes the call feel like a contract.
        expectsAnswer: false,
      });
    }
  }

  return segments;
}

export type ConsentOutcome =
  /** The candidate actively agreed. */
  | { status: "granted"; explicit: true; reason: string }
  /**
   * No explicit yes was required, and the candidate did not refuse. This is the
   * continuation-as-consent model, and it is recorded as a DIFFERENT status from
   * an explicit yes — because it is different, and a privacy log that reported
   * both as "consent given" would overstate what happened.
   */
  | { status: "granted"; explicit: false; reason: string }
  | { status: "declined"; reason: string }
  /** An explicit yes was required and has not arrived yet. The call waits. */
  | { status: "pending"; reason: string };

/**
 * Decides what the candidate's answer to the disclosure means.
 *
 * THE BIAS IS TOWARDS STOPPING, in both modes. `isConsentRefusal` is already
 * deliberately generous about what counts as a refusal — "later", "busy",
 * "wrong number" all count — and that generosity is what makes this safe: the
 * cost of misreading a refusal as consent is that the product records somebody
 * who said no, while the cost of the opposite is one call that has to be made by
 * a person.
 */
export function resolveConsentOutcome({
  settings,
  answer,
}: {
  settings: PrivacySettings;
  answer: string | null | undefined;
}): ConsentOutcome {
  if (isConsentRefusal(answer)) {
    return { status: "declined", reason: "The candidate declined to continue." };
  }

  const said = typeof answer === "string" ? answer.trim() : "";

  if (settings.consent.requireExplicitConsent) {
    if (said.length === 0) {
      return {
        status: "pending",
        reason: "Waiting for the candidate to confirm before continuing.",
      };
    }

    return {
      status: "granted",
      explicit: true,
      reason: "The candidate confirmed they were happy to continue.",
    };
  }

  // Explicit consent not required. Silence is not agreement — but it is also not
  // a refusal, and the call has not reached a point where anything was recorded.
  // Pending keeps the flow honest: the disclosure was made and nothing came back.
  if (said.length === 0) {
    return {
      status: "pending",
      reason: "The disclosure was made and the candidate has not responded yet.",
    };
  }

  return {
    status: "granted",
    explicit: false,
    reason: "The candidate was told the call is automated and recorded, and continued.",
  };
}

/**
 * May this call capture audio?
 *
 * THE GATE THAT IS NOT CONFIGURABLE, expressed where the call flow reads it.
 *
 * Recording requires two things: the organization asked for it, and the
 * candidate has not refused. It does NOT require an explicit yes — an
 * organization operating under one-party consent may record on continuation —
 * but it does require that consent is not in the `declined` state, and the
 * disclosure that makes continuation meaningful is always spoken.
 *
 * A `pending` outcome cannot record. That is the important line: it is the state
 * where the disclosure has been made and nothing has come back, and recording
 * during it would capture a person who has not yet had the chance to say no.
 */
export function mayCaptureAudio({
  settings,
  consent,
}: {
  settings: PrivacySettings;
  consent: ConsentOutcome;
}): boolean {
  if (!resolveDataCollection(settings).audioRecording) return false;
  return consent.status === "granted";
}

/**
 * What is kept when a candidate declines.
 *
 * §2: "Follow the configured policy for recording and transcript storage."
 * Metadata is always kept — see METADATA_IS_MANDATORY. Without a record that a
 * refusal happened, the product cannot honour it, cannot stop re-dialling, and
 * cannot show it in the §10 log.
 */
export function artifactsKeptOnDecline(settings: PrivacySettings): {
  artifacts: RetainableArtifact[];
  metadata: true;
} {
  switch (settings.consent.declinePolicy) {
    case "metadata_only":
      return { artifacts: [], metadata: true };
    case "keep_transcript":
      return { artifacts: ["transcript"], metadata: true };
    case "keep_all":
      // Still intersected with what the organization stores at all: "keep
      // everything" cannot mean "keep audio" if audio storage is switched off.
      return {
        artifacts: (["transcript", "audioRecording", "aiEvaluation"] as RetainableArtifact[]).filter(
          (artifact) => {
            const allowed = resolveDataCollection(settings);
            if (artifact === "audioRecording") return allowed.audioRecording;
            if (artifact === "transcript") return allowed.transcript;
            return allowed.aiEvaluation;
          }
        ),
        metadata: true,
      };
  }
}

/**
 * A one-line summary of the consent configuration, for the settings screen.
 *
 * Written so that the OFF state reads accurately rather than reassuringly. An
 * admin who has switched the gate off should see what that actually means, and
 * should also see the part that did not change.
 */
export function describeConsent(settings: PrivacySettings): string {
  const recording = settings.recording.enabled
    ? "The call may be recorded."
    : "The call is not recorded.";

  if (settings.consent.requireExplicitConsent) {
    return (
      `${recording} The agent states this at the start and waits for the candidate to ` +
      `agree before asking anything. Silence or an unclear answer ends the call.`
    );
  }

  return (
    `${recording} The agent states this at the start; a candidate who continues is treated ` +
    `as consenting, and one who declines ends the call. No spoken confirmation is required.`
  );
}
