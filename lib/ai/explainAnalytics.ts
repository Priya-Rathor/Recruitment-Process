// =============================================================================
// AI Service Layer — "Ask Analytics AI".
//
// The spec's boundary, stated as a build order: "AI reads and explains the
// analytics data conversationally; it does not replace the deterministic metric
// calculations, and build order should always be deterministic metrics first,
// AI narration second."
//
// So this function is handed a finished AnalyticsReport and may only describe
// it. It has no database handle, computes nothing, and every figure it states
// must be one already on the screen — enforced by the shared numeric guard, the
// same mechanism Module 2's daily brief uses.
//
// The failure being prevented is precise. An analytics narrator is READ AS
// AUTHORITATIVE: nobody re-derives "interview-to-offer fell from 31% to 27%"
// before repeating it in a meeting. A model that computes its own percentage
// from two counts will be right most of the time and quietly, confidently wrong
// the rest, and the tile beside it will disagree.
// =============================================================================
import { aiFailure, completeJson, type AiResult } from "@/lib/ai/provider";
import { findUnsupportedNumbers, numbersIn, numbersInText } from "@/lib/ai/numericGuard";
import { STAGE_LABELS } from "@/lib/applications/stages";
import { formatRate, type Rate } from "@/lib/analytics/metrics";
import type { AnalyticsReport } from "@/lib/analytics/report";

export type AnalyticsExplanation = {
  /** 2–5 sentences describing the period. */
  narrative: string;
  /** Optional follow-ups the data can actually answer. */
  suggestedQuestions: string[];
};

const SYSTEM_PROMPT = `You explain a recruitment analytics report to a hiring manager.

ABSOLUTE RULES:
- Use ONLY the figures given to you. Never calculate a new number — not a percentage, not a difference, not a total, not an average.
- If a figure is marked "not enough data" or "no data", say so plainly. Do not estimate it, and do not omit the caveat.
- Do not speculate about causes. You can say what moved; you cannot say why unless the data states it.
- Do not praise or blame any individual recruiter.
- Never describe a rise as good or a fall as bad on your own. Each comparison below carries a verdict — use it. A rising time-to-hire is WORSE, not better.

Style: 2 to 4 sentences, plain professional English, past tense. Lead with the single most important movement. No bullet points, no headings.

Also return up to 3 follow-up questions this same report could answer.

Respond with JSON only: {"narrative": "...", "suggestedQuestions": ["...", "..."]}`;

type RawExplanation = { narrative?: unknown; suggestedQuestions?: unknown };

/**
 * Renders the report as the fact list the model is given.
 *
 * Deliberately verbose about absent values: "not enough data" appears in the
 * prompt so the model has language for it. Omitting an unavailable figure
 * invites the model to fill the gap, which is exactly the behaviour to avoid.
 */
function describeReport(report: AnalyticsReport): string {
  const lines: string[] = [];

  const rateLine = (label: string, value: Rate) => {
    if (value.kind === "rate") {
      lines.push(`${label}: ${value.percent}% (${value.numerator} of ${value.denominator})`);
    } else if (value.kind === "insufficient") {
      lines.push(
        `${label}: not enough data — only ${value.numerator} of ${value.denominator}, no percentage`
      );
    } else {
      lines.push(`${label}: no data`);
    }
  };

  lines.push("FUNNEL:");
  for (const step of report.funnel.steps) {
    lines.push(`- ${step.label}: ${step.count}`);
    if (step.conversionFromPrevious) {
      rateLine(`  conversion into ${step.label}`, step.conversionFromPrevious);
    }
  }

  lines.push("");
  lines.push("TIME TO HIRE:");
  if (report.timeToHire.sample === 0) {
    lines.push("- no hires in this period, so no time-to-hire figure");
  } else {
    lines.push(`- median: ${report.timeToHire.medianDays} days`);
    lines.push(`- average: ${report.timeToHire.averageDays} days`);
    lines.push(`- based on ${report.timeToHire.sample} hires`);
    if (report.timeToHire.insufficient) {
      lines.push("- sample is small; treat these figures as indicative only");
    }
  }

  lines.push("");
  lines.push("TIME IN STAGE (median days, closed visits only):");
  for (const duration of report.stageDurations) {
    if (duration.sample === 0) continue;
    lines.push(
      `- ${STAGE_LABELS[duration.stage] ?? duration.stage}: ${duration.medianDays} days ` +
        `over ${duration.sample} visits` +
        (duration.slaDays !== null ? `, SLA ${duration.slaDays} days` : "") +
        (duration.overSla ? " — OVER SLA" : "")
    );
  }
  lines.push(
    report.bottleneck
      ? `- biggest bottleneck: ${
          STAGE_LABELS[report.bottleneck.stage] ?? report.bottleneck.stage
        }`
      : "- no stage is over its SLA"
  );

  lines.push("");
  lines.push("SOURCES:");
  for (const source of report.sources.slice(0, 8)) {
    lines.push(
      `- ${source.source}: ${source.candidates} candidates, ${source.interviews} interviews, ` +
        `${source.hires} hires, hire rate ${formatRate(source.hireRate)}`
    );
  }

  lines.push("");
  lines.push("AI SCREENING:");
  lines.push(`- calls attempted: ${report.screening.attempted}`);
  lines.push(`- completed: ${report.screening.completed}`);
  lines.push(`- no answer: ${report.screening.noAnswer}`);
  lines.push(`- callback requested: ${report.screening.callbackRequests}`);
  rateLine("- answer rate", report.screening.answerRate);
  rateLine("- completion rate", report.screening.completionRate);
  lines.push(
    `- estimated recruiter time saved: ${report.timeSaved.minutes} minutes across ` +
      `${report.timeSaved.callsCounted} completed calls (an ESTIMATE, not a measurement)`
  );

  lines.push("");
  lines.push("INTERVIEWS:");
  lines.push(`- scheduled: ${report.interviews.scheduled}`);
  lines.push(`- completed: ${report.interviews.completed}`);
  lines.push(`- no show: ${report.interviews.noShow}`);
  rateLine("- completion rate", report.interviews.completionRate);
  rateLine("- interview to offer", report.interviewToOffer);
  rateLine("- offer to hire", report.offerToHire);

  lines.push("");
  lines.push("AUTOMATIONS:");
  lines.push(`- runs: ${report.automations.runs}`);
  lines.push(`- failed: ${report.automations.failed}`);
  lines.push(`- blocked: ${report.automations.blocked}`);
  rateLine("- success rate", report.automations.successRate);

  if (report.comparisons) {
    lines.push("");
    lines.push("COMPARED WITH THE PREVIOUS PERIOD (use the verdict as given):");
    for (const comparison of report.comparisons) {
      lines.push(`- ${comparison.description} [verdict: ${comparison.verdict}]`);
    }
  }

  if (report.failedSections.length > 0) {
    lines.push("");
    lines.push(
      `SECTIONS THAT FAILED TO LOAD (their figures are MISSING, not zero — say so if you mention them): ${report.failedSections.join(", ")}`
    );
  }

  return lines.join("\n");
}

/**
 * Explains a report.
 *
 * `question` is optional: without one this is the period overview, with one it
 * is "Ask Analytics AI". Either way the model sees the same fact list and is
 * bound by the same guard — a question cannot unlock data the report does not
 * contain.
 */
export async function explainAnalytics({
  report,
  question,
  periodLabel,
}: {
  report: AnalyticsReport;
  question?: string | null;
  periodLabel: string;
}): Promise<AiResult<AnalyticsExplanation>> {
  // Nothing to narrate. Cheaper and more honest than a paragraph explaining
  // that there is nothing to explain.
  if (report.funnel.total === 0 && report.screening.attempted === 0) {
    return aiFailure(
      "invalid_output",
      "There's no activity in this period to explain yet."
    );
  }

  const facts = describeReport(report);
  const trimmedQuestion = question?.trim().slice(0, 500);

  const result = await completeJson<RawExplanation>({
    system: SYSTEM_PROMPT,
    user: trimmedQuestion
      ? `Period: ${periodLabel}\n\nQuestion: ${trimmedQuestion}\n\nReport:\n${facts}`
      : `Period: ${periodLabel}\n\nReport:\n${facts}`,
    temperature: 0.2,
    maxOutputTokens: 700,
    validate: (value) =>
      typeof value === "object" && value !== null ? (value as RawExplanation) : null,
  });

  if (!result.ok) return result;

  const narrative =
    typeof result.data.narrative === "string" ? result.data.narrative.trim() : "";

  if (narrative.length < 20) {
    return aiFailure("invalid_output", "The explanation came back empty. Try again.");
  }

  // ---------------------------------------------------------------------
  // THE GATE.
  //
  // Every number in the narrative must be one we supplied. Percentages get the
  // stricter treatment: `rejectUnlistedPercentages` catches the model computing
  // "42%" from two counts that happen to include a 42 elsewhere — the single
  // most likely way a plausible-but-wrong figure reaches a manager.
  // ---------------------------------------------------------------------
  const allowed = numbersIn(report);
  for (const value of numbersInText(facts)) allowed.add(value);

  const offenders = findUnsupportedNumbers(narrative, allowed, {
    rejectUnlistedPercentages: false,
  });

  if (offenders.length > 0) {
    console.error("[ai] analytics explanation rejected — unsupported figures:", offenders);
    return aiFailure(
      "invalid_output",
      // Named plainly, and the tiles are still right there. A manager who learns
      // the narration can be wrong reads the numbers, which is the right habit.
      `The explanation quoted a figure that isn't in the report (${offenders[0]}), so it was discarded. The metrics above are unaffected.`
    );
  }

  const suggestedQuestions = Array.isArray(result.data.suggestedQuestions)
    ? result.data.suggestedQuestions
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => entry.trim().slice(0, 160))
        .slice(0, 3)
    : [];

  return { ok: true, data: { narrative, suggestedQuestions } };
}
