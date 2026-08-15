// =============================================================================
// Deterministic metric calculation.
//
// The spec's build order: "deterministic metrics first, AI narration second".
// Everything here is a pure function over rows already fetched — no database
// handle, no clock of its own, no model. That is what lets the same functions
// produce the on-screen figures AND the CSV export, which is how the spec's
// "CSV export matches on-screen filtered results exactly" is satisfied by
// construction rather than by two implementations agreeing.
//
// THE RULE THAT SHAPES THIS WHOLE FILE: a rate needs a denominator, and a
// denominator of 0 has no rate. Not 0%, not 100% — none. And a rate over a
// sample of one is arithmetically fine and editorially useless: "100% hire
// rate" from a single application will be quoted in a meeting.
//
// So every rate returns `Rate`, which can say `insufficient`, and the UI is
// obliged to handle it. Returning a bare number would make the misleading case
// the easy one.
// =============================================================================
import { APPLICATION_STAGES, type ApplicationStage } from "@/lib/applications/stages";

/**
 * Below this many observations a rate is reported as insufficient rather than
 * as a percentage.
 *
 * Three, not one. Two data points give 0%, 50% or 100% — all of which read as
 * findings and none of which are.
 */
export const MIN_SAMPLE_FOR_RATE = 3;

export type Rate =
  | { kind: "rate"; percent: number; numerator: number; denominator: number }
  /** Nothing to divide by — genuinely no answer, distinct from an answer of 0. */
  | { kind: "no_data" }
  /** Denominator too small for the percentage to mean anything. */
  | { kind: "insufficient"; numerator: number; denominator: number };

/**
 * Computes a rate, or explains why it cannot.
 *
 * `minSample` is overridable because some denominators are legitimately
 * meaningful at n=1 (e.g. "did this one automation run fail?"), but the default
 * protects the reporting surfaces where a stray percentage does damage.
 */
export function rate(
  numerator: number,
  denominator: number,
  minSample: number = MIN_SAMPLE_FOR_RATE
): Rate {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return { kind: "no_data" };
  }
  if (denominator < minSample) {
    return { kind: "insufficient", numerator, denominator };
  }
  return {
    kind: "rate",
    percent: Math.round((numerator / denominator) * 1000) / 10,
    numerator,
    denominator,
  };
}

/** Renders a Rate for display. Never invents a number for the absent cases. */
export function formatRate(value: Rate): string {
  switch (value.kind) {
    case "rate":
      return `${value.percent}%`;
    case "insufficient":
      return `${value.numerator}/${value.denominator}`;
    case "no_data":
      return "—";
  }
}

/** Why a rate is missing, for a tooltip or caption. */
export function explainRate(value: Rate): string | null {
  switch (value.kind) {
    case "rate":
      return null;
    case "insufficient":
      return `Not enough data for a meaningful percentage — ${value.numerator} of ${value.denominator}.`;
    case "no_data":
      return "No data in this period.";
  }
}

// -----------------------------------------------------------------------------
// The funnel
// -----------------------------------------------------------------------------

export type FunnelRow = {
  application_id: string;
  source: string | null;
  current_stage: ApplicationStage;
  assigned_recruiter_id: string | null;
  job_id: string | null;
  client_id: string | null;
  created_at: string;
  hired_at: string | null;
  reached_screening: boolean;
  reached_shortlisted: boolean;
  reached_client_review: boolean;
  reached_interview: boolean;
  reached_offer: boolean;
  reached_hired: boolean;
  reached_rejected: boolean;
  screening_call_attempted: boolean;
  screening_call_completed: boolean;
  match_score: number | null;
};

export type FunnelStep = {
  key: string;
  label: string;
  count: number;
  /** Conversion from the PREVIOUS step. Null on the first step. */
  conversionFromPrevious: Rate | null;
};

export type Funnel = {
  steps: FunnelStep[];
  total: number;
};

/**
 * Builds the funnel.
 *
 * "AI Screened" counts applications where a call was actually PLACED, not those
 * that merely reached the Screening stage. The spec's own example figures treat
 * it as a real activity count, and reporting stage-arrivals as screenings would
 * overstate the product's own contribution — the number most likely to be
 * quoted back to a customer.
 *
 * Steps are cumulative and monotonic by construction, because each is an
 * ever-reached flag from the immutable stage history. A funnel whose later step
 * exceeds an earlier one is a bug, not a data quirk, and this shape makes it
 * impossible.
 */
export function buildFunnel(rows: FunnelRow[]): Funnel {
  const total = rows.length;

  const counts = [
    { key: "applications", label: "Applications", count: total },
    {
      key: "screened",
      label: "AI screened",
      count: rows.filter((row) => row.screening_call_attempted).length,
    },
    {
      key: "shortlisted",
      label: "Shortlisted",
      count: rows.filter((row) => row.reached_shortlisted).length,
    },
    {
      key: "interviews",
      label: "Interviews",
      count: rows.filter((row) => row.reached_interview).length,
    },
    {
      key: "offers",
      label: "Offers",
      count: rows.filter((row) => row.reached_offer).length,
    },
    {
      key: "hired",
      label: "Hired",
      count: rows.filter((row) => row.reached_hired).length,
    },
  ];

  return {
    total,
    steps: counts.map((step, index) => ({
      ...step,
      conversionFromPrevious:
        index === 0 ? null : rate(step.count, counts[index - 1].count),
    })),
  };
}

// -----------------------------------------------------------------------------
// Time to hire
// -----------------------------------------------------------------------------

export type TimeToHire = {
  /** Mean days, or null when nobody was hired in the period. */
  averageDays: number | null;
  /** Median days. The spec asks for it explicitly, to resist outliers. */
  medianDays: number | null;
  /** How many hires the figures are built from. */
  sample: number;
  /** True when the sample is too small to be worth reading. */
  insufficient: boolean;
};

/**
 * Time from application to hire.
 *
 * Both mean and median, because one long-running requisition drags the mean
 * badly and a manager reading only the mean concludes the process is slower
 * than it is. Reported together so the gap between them is itself visible.
 */
export function computeTimeToHire(rows: FunnelRow[]): TimeToHire {
  const durations: number[] = [];

  for (const row of rows) {
    if (!row.hired_at) continue;

    const created = new Date(row.created_at).getTime();
    const hired = new Date(row.hired_at).getTime();
    if (Number.isNaN(created) || Number.isNaN(hired)) continue;
    // Guards a clock skew or a back-dated import producing a negative duration,
    // which would silently pull the average down.
    if (hired < created) continue;

    durations.push((hired - created) / 86_400_000);
  }

  if (durations.length === 0) {
    return { averageDays: null, medianDays: null, sample: 0, insufficient: true };
  }

  const sorted = [...durations].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);

  return {
    averageDays: round1(sum / sorted.length),
    medianDays: round1(median(sorted)),
    sample: sorted.length,
    insufficient: sorted.length < MIN_SAMPLE_FOR_RATE,
  };
}

// -----------------------------------------------------------------------------
// Time in stage
// -----------------------------------------------------------------------------

export type StageDurationRow = {
  stage: ApplicationStage;
  days_in_stage: number;
};

export type StageDuration = {
  stage: ApplicationStage;
  averageDays: number | null;
  medianDays: number | null;
  sample: number;
  insufficient: boolean;
  /** True once the average exceeds this stage's configured SLA. */
  overSla: boolean;
  slaDays: number | null;
};

/**
 * Average and median days per stage, flagged against the configured SLA.
 *
 * Built from CLOSED stage visits only (the view enforces that), so a stage
 * nobody has left yet reports no data rather than a figure that grows on every
 * page load.
 *
 * The bottleneck is identified by the MEDIAN, not the mean. One application
 * stuck in Client Review for six months makes that stage look like the
 * bottleneck under a mean even when everything else moves through it in a day.
 */
export function computeStageDurations({
  rows,
  slaDays,
}: {
  rows: StageDurationRow[];
  /** Per-stage SLA from Module 10's pipeline_sla_config. */
  slaDays: Partial<Record<ApplicationStage, number>>;
}): StageDuration[] {
  return APPLICATION_STAGES.map((stage) => {
    const durations = rows
      .filter((row) => row.stage === stage && Number.isFinite(row.days_in_stage))
      .map((row) => row.days_in_stage)
      .sort((a, b) => a - b);

    const sla = slaDays[stage] ?? null;

    if (durations.length === 0) {
      return {
        stage,
        averageDays: null,
        medianDays: null,
        sample: 0,
        insufficient: true,
        overSla: false,
        slaDays: sla,
      };
    }

    const average = durations.reduce((total, value) => total + value, 0) / durations.length;
    const med = median(durations);

    return {
      stage,
      averageDays: round1(average),
      medianDays: round1(med),
      sample: durations.length,
      insufficient: durations.length < MIN_SAMPLE_FOR_RATE,
      // Never flag a stage as a bottleneck on a sample too small to mean it.
      overSla: sla !== null && durations.length >= MIN_SAMPLE_FOR_RATE && med > sla,
      slaDays: sla,
    };
  });
}

/**
 * The worst over-SLA stage, or null.
 *
 * Only considers stages actually over their SLA with a real sample, so an
 * organization running smoothly gets "no bottleneck" rather than "the least
 * good stage" dressed up as a problem.
 */
export function findBottleneck(durations: StageDuration[]): StageDuration | null {
  const candidates = durations.filter((entry) => entry.overSla && entry.medianDays !== null);
  if (candidates.length === 0) return null;

  return candidates.reduce((worst, entry) =>
    (entry.medianDays as number) - (entry.slaDays ?? 0) >
    (worst.medianDays as number) - (worst.slaDays ?? 0)
      ? entry
      : worst
  );
}

// -----------------------------------------------------------------------------
// Source performance
// -----------------------------------------------------------------------------

export type SourcePerformance = {
  source: string;
  candidates: number;
  interviews: number;
  hires: number;
  hireRate: Rate;
  interviewRate: Rate;
};

/** Per-source counts and rates, busiest first. */
export function computeSourcePerformance(rows: FunnelRow[]): SourcePerformance[] {
  const bySource = new Map<string, FunnelRow[]>();

  for (const row of rows) {
    const source = row.source ?? "unknown";
    const bucket = bySource.get(source) ?? [];
    bucket.push(row);
    bySource.set(source, bucket);
  }

  return [...bySource.entries()]
    .map(([source, bucket]) => {
      const interviews = bucket.filter((row) => row.reached_interview).length;
      const hires = bucket.filter((row) => row.reached_hired).length;

      return {
        source,
        candidates: bucket.length,
        interviews,
        hires,
        hireRate: rate(hires, bucket.length),
        interviewRate: rate(interviews, bucket.length),
      };
    })
    .sort((a, b) => b.candidates - a.candidates);
}

// -----------------------------------------------------------------------------
// Screening & Bolna
// -----------------------------------------------------------------------------

export type ScreeningCallRow = {
  call_id: string;
  status: string;
  duration_seconds: number | null;
  language: string | null;
  consent_confirmed: boolean;
};

export type ScreeningMetrics = {
  attempted: number;
  answered: number;
  completed: number;
  noAnswer: number;
  failed: number;
  cancelled: number;
  answerRate: Rate;
  completionRate: Rate;
  averageDurationSeconds: number | null;
  /** Candidates who declined the automated call — a number worth watching. */
  callbackRequests: number;
  byLanguage: { language: string; calls: number }[];
};

export function computeScreeningMetrics(rows: ScreeningCallRow[]): ScreeningMetrics {
  const attempted = rows.length;
  const completed = rows.filter((row) => row.status === "completed").length;
  const noAnswer = rows.filter((row) => row.status === "no_answer").length;
  const failed = rows.filter((row) => row.status === "failed").length;
  // Module 8 maps a consent refusal to `cancelled` — the candidate answered and
  // asked for a person, so it counts as answered but not completed.
  const cancelled = rows.filter((row) => row.status === "cancelled").length;
  const answered = completed + cancelled;

  const durations = rows
    .map((row) => row.duration_seconds)
    .filter((value): value is number => typeof value === "number" && value > 0);

  const byLanguage = new Map<string, number>();
  for (const row of rows) {
    const language = row.language ?? "unknown";
    byLanguage.set(language, (byLanguage.get(language) ?? 0) + 1);
  }

  return {
    attempted,
    answered,
    completed,
    noAnswer,
    failed,
    cancelled,
    answerRate: rate(answered, attempted),
    completionRate: rate(completed, attempted),
    averageDurationSeconds:
      durations.length > 0
        ? Math.round(durations.reduce((total, value) => total + value, 0) / durations.length)
        : null,
    callbackRequests: cancelled,
    byLanguage: [...byLanguage.entries()]
      .map(([language, calls]) => ({ language, calls }))
      .sort((a, b) => b.calls - a.calls),
  };
}

/**
 * Minutes a recruiter would have spent making these calls by hand.
 *
 * AN ESTIMATE, and the spec requires it be "labeled explicitly as an estimate".
 * The assumption is stated here rather than buried: a manual screening call
 * takes about as long as the automated one plus a fixed overhead for dialling,
 * waiting, and writing notes.
 *
 * Only COMPLETED calls count. A no-answer saves nobody anything — a recruiter
 * would also have got no answer.
 */
export const MANUAL_CALL_OVERHEAD_MINUTES = 8;

export function estimateTimeSaved(rows: ScreeningCallRow[]): {
  minutes: number;
  callsCounted: number;
  assumption: string;
} {
  const completed = rows.filter((row) => row.status === "completed");

  const minutes = completed.reduce((total, row) => {
    const callMinutes = (row.duration_seconds ?? 0) / 60;
    return total + callMinutes + MANUAL_CALL_OVERHEAD_MINUTES;
  }, 0);

  return {
    minutes: Math.round(minutes),
    callsCounted: completed.length,
    assumption: `Estimate: each completed call's own duration plus ${MANUAL_CALL_OVERHEAD_MINUTES} minutes for dialling, waiting and note-taking. Only completed calls are counted.`,
  };
}

// -----------------------------------------------------------------------------
// Interviews, offers, automations
// -----------------------------------------------------------------------------

export type InterviewRow = {
  id: string;
  status: string;
  has_feedback: boolean;
};

export type InterviewMetrics = {
  scheduled: number;
  completed: number;
  cancelled: number;
  noShow: number;
  completionRate: Rate;
  feedbackRate: Rate;
};

export function computeInterviewMetrics(rows: InterviewRow[]): InterviewMetrics {
  const scheduled = rows.length;
  const completed = rows.filter((row) => row.status === "completed").length;
  const cancelled = rows.filter((row) => row.status === "cancelled").length;
  const noShow = rows.filter((row) => row.status === "no_show").length;

  return {
    scheduled,
    completed,
    cancelled,
    noShow,
    completionRate: rate(completed, scheduled),
    feedbackRate: rate(rows.filter((row) => row.has_feedback).length, completed),
  };
}

export type AutomationRunRow = {
  automation_id: string;
  automation_name: string;
  status: string;
};

export type AutomationMetrics = {
  runs: number;
  succeeded: number;
  failed: number;
  skipped: number;
  blocked: number;
  successRate: Rate;
  /** Per-automation failures, worst first — the spec's failure table. */
  failures: { automationId: string; name: string; failed: number; runs: number }[];
};

export function computeAutomationMetrics(rows: AutomationRunRow[]): AutomationMetrics {
  const succeeded = rows.filter((row) => row.status === "success").length;
  const failed = rows.filter((row) => row.status === "failed").length;
  const skipped = rows.filter((row) => row.status === "skipped").length;
  const blocked = rows.filter((row) => row.status === "blocked").length;

  const byAutomation = new Map<string, { name: string; failed: number; runs: number }>();
  for (const row of rows) {
    const entry = byAutomation.get(row.automation_id) ?? {
      name: row.automation_name,
      failed: 0,
      runs: 0,
    };
    entry.runs += 1;
    if (row.status === "failed") entry.failed += 1;
    byAutomation.set(row.automation_id, entry);
  }

  return {
    runs: rows.length,
    succeeded,
    failed,
    skipped,
    blocked,
    // Skips are normal operation, not attempts — a rule whose conditions did not
    // match has not "failed to succeed". Including them would make a healthy
    // narrow rule look broken.
    successRate: rate(succeeded, succeeded + failed + blocked),
    failures: [...byAutomation.entries()]
      .filter(([, entry]) => entry.failed > 0)
      .map(([automationId, entry]) => ({ automationId, ...entry }))
      .sort((a, b) => b.failed - a.failed),
  };
}

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
