"use client";

// =============================================================================
// The Voice Agent Console — one continuously scrollable page.
//
// No sidebar, no tabs, no wizard, no per-section save. Nine stacked sections, one
// sticky Save button, and a switcher at the top when there is more than one
// agent. Everything the page can change is in ONE state object, which is what
// makes "Save persists the entire form in one request" true rather than aspirational.
//
// PROVIDER NEUTRALITY IS A PROPERTY OF THIS FILE.
//
// There is no provider name in the copy, no API key field, no credential display,
// and nothing here fetches from a provider. Options arrive as opaque keys with
// scrubbed labels, and the only provider fact the page knows is whether the
// integration is "connected". It lives at /settings/agents/voice, inside the
// Agent Center; /settings/integrations/bolna redirects here.
//
// WHAT LIVES IN state VS WHAT LIVES IN THE DOM
//
// Every field is a controlled input reading from `draft`, so there is no
// "edit mode", no per-field commit, and no way for the visible form and the thing
// that gets saved to differ. `baseline` is the last-saved copy; the dirty flag is
// a comparison of the two rather than a boolean somebody has to remember to set —
// which is why undoing an edit by hand correctly clears the unsaved indicator.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleDot,
  PhoneCall,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { FormError } from "@/components/ui/states";
import { PlaceholderEditor } from "@/components/PlaceholderEditor";
import { StringListEditor } from "@/app/jobs/StringListEditor";
import {
  AGENT_PURPOSES,
  AGENT_TONES,
  CONFIGURABLE_SECTIONS,
  canSaveAgent,
  configuredSections,
  isDialableNumber,
  withDialCode,
  LIMITS,
  PURPOSE_LABELS,
  RESPONSE_LENGTHS,
  type AgentPurpose,
  type AgentSettings,
  type AgentTone,
  type ResponseLength,
} from "@/lib/voice/settings";
import type { AgentCatalog } from "@/lib/voice/catalog";
import type { DefaultCallData } from "@/lib/voice/callData";
import type { PreviewJobOption, TestCall, VoiceAgent } from "@/lib/voice/queries";
import { ConsoleSection } from "./ConsoleSection";
import { CallDataSection } from "./CallDataSection";
import { TestAgentSection } from "./TestAgentSection";
import { CatalogSelect, NumberField, Slider, ToggleRow } from "./controls";
import { AgentCostHeader } from "./AgentCostHeader";
import { PromptAiEdit } from "./PromptAiEdit";
import { useTestCall } from "./useTestCall";
import type { Mode as TestMode } from "./TestAgentSection";
import type { CostEstimate } from "@/lib/voice/costModel";

/** The anchor-nav row, and the section ids it scrolls to. */
const SECTIONS = [
  { id: "general", label: "General" },
  { id: "greeting", label: "Greeting" },
  { id: "brain", label: "Brain" },
  { id: "voice", label: "Voice" },
  { id: "speech", label: "Speech" },
  { id: "behavior", label: "Behavior" },
  { id: "calldata", label: "Call Data" },
  { id: "handoff", label: "Handoff" },
  { id: "test", label: "Test" },
];

/**
 * The header's call button.
 *
 * Solid primary: it is the most consequential thing on the header row. Save is
 * the page's other solid button and they never appear in the same row — this one
 * sits beside the agent name, Save sits in the fixed bar at the bottom.
 */
function GetCallButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="small" variant="primary" icon={PhoneCall} onClick={onClick}>
      Get call from agent
    </Button>
  );
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  /** Stored here, but the provider does not have it. Not a success. */
  | { kind: "saved_unsynced"; message: string }
  | { kind: "error"; message: string };

export function VoiceAgentConsole({
  initialAgents,
  initialActiveId,
  catalog,
  connection,
  jobs,
  initialTestCall,
  costEstimate,
  organizationName,
}: {
  initialAgents: VoiceAgent[];
  /** The agent to open on — the Agent Center's Manage link. Defaults to the first. */
  initialActiveId: string | null;
  catalog: AgentCatalog;
  connection: { connected: boolean; encryptionUnavailable: boolean };
  jobs: PreviewJobOption[];
  initialTestCall: TestCall | null;
  /** From OUR usage ledger, or an explicit not-tracked state. See lib/voice/cost. */
  costEstimate: CostEstimate;
  organizationName: string;
}) {
  const router = useRouter();

  const [agents, setAgents] = useState(initialAgents);
  const [activeId, setActiveId] = useState(initialActiveId ?? initialAgents[0]?.id ?? null);

  const active = agents.find((agent) => agent.id === activeId) ?? null;

  const testCall = useTestCall({
    agentId: activeId ?? "",
    // Only the agent the console opened on has a preloaded history; switching
    // agents starts with none and the section's own poll fills it in.
    initialCall: activeId === initialActiveId ? initialTestCall : null,
  });

  const [draft, setDraft] = useState<AgentSettings | null>(active?.settings ?? null);
  const [baseline, setBaseline] = useState<AgentSettings | null>(active?.settings ?? null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [creating, setCreating] = useState(false);
  /** The agent a switch is waiting on, while unsaved changes are confirmed. */
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  /** Which anchor is highlighted. Presentation only. */
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);
  /**
   * Suppresses the observer while a click-driven smooth scroll is in flight.
   *
   * Without it the highlight walks through every section the page passes over on
   * the way to the target — which looks like a bug, not like navigation.
   */
  const scrollingTo = useRef<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  /*
    Test-call state lives HERE so the header button and the Test Agent section
    drive the same flow. See useTestCall — one place that dials, one confirmation.

    `testOpen` and `testMode` are here for the same reason: the header button has
    to open that section and switch it to Call before arming a confirmation the
    reader needs to see.
  */
  const [testOpen, setTestOpen] = useState(false);
  const [testMode, setTestMode] = useState<TestMode>("call");

  const dirty = useMemo(
    () => draft !== null && baseline !== null && JSON.stringify(draft) !== JSON.stringify(baseline),
    [draft, baseline]
  );

  /*
    The ONLY reason Save is unavailable: there is nothing to save.

    An unsynced save is excluded because retrying it is exactly what the button is
    for at that point, even with no further edits. Unchanged behaviour — extracted
    from the JSX so the button, its tooltip and its styling all read the same
    condition instead of three copies of it.
  */
  // The rule lives in lib/voice/settings.ts so it can be tested — see canSaveAgent.

  // Recomputed on every render rather than stored, so it can never disagree with
  // the form above it.
  const configured = draft ? configuredSections(draft) : [];

  /*
    An invalid caller number blocks the save.

    Not a silent correction: the field says what is wrong and Save says why it
    cannot run, because rewriting somebody's phone number for them is exactly the
    kind of help that ends in a call to the wrong person. Empty stays valid — the
    field is optional.
  */
  const callerNumberValid = draft ? isDialableNumber(draft.general.callerNumber) : true;

  const saveDisabled = !canSaveAgent({
    dirty,
    unsynced: saveState.kind === "saved_unsynced",
    callerNumberValid,
  });

  /**
   * The navigate-away warning.
   *
   * `beforeunload` covers a closed tab or a typed URL. It cannot cover Next's
   * client-side router — browsers give no hook for that — so the switcher does its
   * own confirmation below, which is the in-app navigation that would actually
   * lose work on this page.
   */
  useEffect(() => {
    if (!dirty) return;

    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Assigning returnValue is what still triggers the prompt in Chromium.
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** Clears a success message once it has been read. Errors stay put. */
  useEffect(() => {
    if (saveState.kind !== "saved") return;
    const timer = setTimeout(() => setSaveState({ kind: "idle" }), 4000);
    return () => clearTimeout(timer);
  }, [saveState]);

  /**
   * Which section the reader is actually looking at.
   *
   * IntersectionObserver rather than a scroll listener: the browser computes
   * visibility off the main thread, so this does not fire a handler on every
   * pixel of a very long page. `rootMargin` pulls the detection line down from the
   * top of the viewport, so a section counts as current once its heading has
   * settled near the top rather than the instant its first pixel appears.
   *
   * Purely presentational — nothing here reads or writes agent state.
   */
  useEffect(() => {
    const nodes = SECTIONS.map((section) => document.getElementById(section.id)).filter(
      (node): node is HTMLElement => node !== null
    );
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Several sections are on screen at once on a tall display, so the topmost
        // intersecting one wins. Picking "the last entry that fired" instead would
        // make the highlight jump around while scrolling.
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (scrollingTo.current !== null && Date.now() < scrollingTo.current) return;
        if (visible[0]) setActiveSection(visible[0].target.id);
      },
      { rootMargin: "-72px 0px -55% 0px", threshold: 0 }
    );

    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const patch = useCallback(
    <K extends keyof AgentSettings>(section: K, values: Partial<AgentSettings[K]>) => {
      setDraft((current) =>
        current === null ? current : { ...current, [section]: { ...current[section], ...values } }
      );
    },
    []
  );

  /**
   * Loads another agent's SAVED values.
   *
   * Both `draft` and `baseline` are replaced from the row, so nothing of the
   * previous agent's unsaved edits survives the switch — the spec's own test.
   * Reading from `agents` rather than re-fetching means the switch is instant and
   * cannot show a half-loaded form.
   */
  function selectAgent(id: string) {
    const next = agents.find((agent) => agent.id === id);
    if (!next) return;

    setActiveId(id);
    setDraft(next.settings);
    setBaseline(next.settings);
    setSaveState({ kind: "idle" });
    setPendingSwitch(null);
    setConfirmingDelete(false);
  }

  function requestSwitch(id: string) {
    if (id === activeId) return;
    if (dirty) {
      setPendingSwitch(id);
      return;
    }
    selectAgent(id);
  }

  /**
   * The header's "Get call from agent".
   *
   * A SHORTCUT, not a second dialler. It opens the Test Agent section, switches it
   * to Call and arms the confirmation — then scrolls there, because this product's
   * rule for anything that telephones a person is a confirmation that NAMES THE
   * NUMBER, and that confirmation lives in the section. Dialling straight from a
   * header click would be a second, weaker safety path.
   */
  function startCallFromHeader() {
    setTestOpen(true);
    setTestMode("call");
    testCall.arm();

    // After the section has actually expanded, or the scroll lands on a heading
    // whose content is still collapsed.
    requestAnimationFrame(() => {
      document.getElementById("test")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function createAgent() {
    setCreating(true);
    setSaveState({ kind: "idle" });

    try {
      const response = await fetch("/api/settings/voice-agents", { method: "POST" });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setSaveState({ kind: "error", message: payload?.error ?? "Couldn't create an agent." });
        return;
      }

      const created = payload.data as VoiceAgent;
      setAgents((current) => [...current, created]);
      setActiveId(created.id);
      setDraft(created.settings);
      setBaseline(created.settings);
    } catch {
      setSaveState({ kind: "error", message: "Couldn't reach the server." });
    } finally {
      setCreating(false);
    }
  }

  async function save() {
    if (!draft || !activeId) return;
    setSaveState({ kind: "saving" });

    try {
      const response = await fetch(`/api/settings/voice-agents/${activeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: draft }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        /*
          THE FORM IS NEVER CLEARED ON ERROR. `draft` is left exactly as the
          person typed it and the baseline is untouched, so the unsaved indicator
          stays on and nothing they wrote is lost to a failed request.
        */
        setSaveState({
          kind: "error",
          message: payload?.error ?? "Couldn't save these settings.",
        });
        return;
      }

      // The server returns the NORMALISED settings — clamped numbers, tidied
      // keys. Adopting them as both draft and baseline means the form shows what
      // was actually stored, so the unsaved dot does not reappear immediately
      // because the server rounded a temperature.
      const stored = payload.data.settings as AgentSettings;
      setDraft(stored);
      setBaseline(stored);
      setAgents((current) =>
        current.map((agent) => (agent.id === activeId ? { ...agent, settings: stored, synced: payload.data.synced } : agent))
      );

      setSaveState(
        payload.data.synced
          ? { kind: "saved" }
          : { kind: "saved_unsynced", message: payload.data.syncError ?? "The provider doesn't have these settings yet." }
      );
    } catch {
      setSaveState({ kind: "error", message: "Couldn't reach the server." });
    }
  }

  async function deleteAgent() {
    if (!activeId) return;
    setSaveState({ kind: "saving" });

    try {
      const response = await fetch(`/api/settings/voice-agents/${activeId}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setSaveState({ kind: "error", message: payload?.error ?? "Couldn't delete that agent." });
        return;
      }
      // Re-read from the server: deleting the default promotes another one in the
      // database, and guessing which locally would be a guess.
      router.refresh();
    } catch {
      setSaveState({ kind: "error", message: "Couldn't reach the server." });
    }
  }

  // ---------------------------------------------------------------------------
  // No agents yet.
  // ---------------------------------------------------------------------------
  if (!active || !draft) {
    return (
      <div className="card">
        <h2 className="title is-5">No voice agent configured</h2>
        <p className="has-text-secondary mb-4" style={{ fontSize: "var(--text-body)" }}>
          A voice agent holds what the automated screening call says and how it behaves. Create one
          to get started — it starts with sensible defaults you can change.
        </p>
        <FormError message={saveState.kind === "error" ? saveState.message : null} />
        {/*
          Solid HERE, unlike the "New agent" button above. On the empty state this
          is the only thing to do on the page, so it is genuinely the primary
          action; beside a Save button it would be competing.
        */}
        <Button variant="primary" icon={Plus} loading={creating} onClick={createAgent}>
          Create a voice agent
        </Button>
      </div>
    );
  }

  return (
    <div className="vac">
      {/* --- 0. Agent switcher ------------------------------------------- */}
      <div className="vac-switcher">
        {agents.length > 1 ? (
          <div className="vac-switcher__row">
            <label className="label" htmlFor="vac-agent">
              Agent
            </label>
            <div className="select">
              <select
                id="vac-agent"
                value={activeId ?? ""}
                onChange={(event) => requestSwitch(event.target.value)}
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.settings.general.name}
                    {agent.isDefault ? " (default)" : ""} — {PURPOSE_LABELS[agent.settings.general.purpose]}
                  </option>
                ))}
              </select>
            </div>
            {/*
              The Default chip travels WITH the selection.

              With one agent it sat beside the heading; the moment a second agent
              existed the heading became a <select> and the chip vanished, leaving
              "(default)" buried in the option text — legible only while the
              dropdown is open. Rendering it here means "which agent actually
              dials?" is answered by the closed control, which is the state the
              page is in almost all the time.
            */}
            {active.isDefault && <StatusChip tone="success" label="Default" />}

            <GetCallButton onClick={startCallFromHeader} />

            <Button
              size="small"
              variant="outline"
              icon={Plus}
              loading={creating}
              onClick={createAgent}
            >
              New agent
            </Button>
          </div>
        ) : (
          /* One agent: no dropdown to choose from, so its name is a heading. */
          <div className="vac-switcher__row">
            <h2 className="title is-5 mb-0">{draft.general.name}</h2>
            {active.isDefault && <StatusChip tone="success" label="Default" />}
            <GetCallButton onClick={startCallFromHeader} />
            {/*
              Outline, not the default Button. "Secondary" renders Bulma's
              unmodified `.button`, which this theme paints near-black — making the
              least important control on the page its heaviest. "Save agent" is the
              one solid button here, and it should stay that way.
            */}
            <Button
              size="small"
              variant="outline"
              icon={Plus}
              loading={creating}
              onClick={createAgent}
            >
              New agent
            </Button>
          </div>
        )}

        {/*
          The cost breakdown, directly under the name and the Default chip.

          Rendered from OUR OWN usage ledger — never from the provider's account
          balance, and there is deliberately no "add funds" control here. Billing
          is the provider's own surface; surfacing a balance in this console would
          also be wrong in a multi-tenant deployment, where the balance is not
          per-organization.
        */}
        <AgentCostHeader estimate={costEstimate} />

        {/*
          How much of this agent has actually been decided.

          EIGHT, not nine: Test Agent is an action, not a setting, so counting it
          would leave this permanently short of its own total — which reads as an
          unfinished agent rather than a finished one. See configuredSections().

          Computed from the DRAFT, so it moves as you fill the form in rather than
          only after a save.
        */}
        <p className="vac-progress">
          <span className="vac-progress__track" aria-hidden="true">
            <span
              className="vac-progress__fill"
              style={{ width: `${(configured.length / CONFIGURABLE_SECTIONS.length) * 100}%` }}
            />
          </span>
          {configured.length} of {CONFIGURABLE_SECTIONS.length} sections configured
        </p>

        {pendingSwitch && (
          <div className="vac-confirm">
            <p>
              You have unsaved changes to <strong>{draft.general.name}</strong>. Switching agents
              discards them.
            </p>
            <div className="buttons">
              <Button size="small" variant="danger" onClick={() => selectAgent(pendingSwitch)}>
                Discard and switch
              </Button>
              <Button size="small" onClick={() => setPendingSwitch(null)}>
                Keep editing
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* --- Anchor nav --------------------------------------------------- */}
      <nav className="vac-anchors" aria-label="Jump to a section">
        {SECTIONS.map((section) => {
          const current = activeSection === section.id;
          return (
            <button
              key={section.id}
              type="button"
              className={`vac-anchors__link${current ? " is-active" : ""}`}
              // Announced, not just coloured: the highlight is the only thing that
              // marks the reader's place, so it has to reach a screen reader too.
              aria-current={current ? "true" : undefined}
              onClick={() => {
                // Claim the highlight immediately. Waiting for the observer would
                // leave the clicked item unlit for the length of the animation.
                setActiveSection(section.id);
                scrollingTo.current = Date.now() + 700;
                document
                  .getElementById(section.id)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              {section.label}
            </button>
          );
        })}
      </nav>

      {/*
        ONE BANNER, NOT TWO.

        These used to stack: a connection warning, and directly beneath it the
        catalogue's own degraded reason — which, when the integration is not
        connected, is that same fact worded differently ("The voice provider isn't
        connected yet"). Two alerts about one problem make a page look broken
        rather than informative.

        The de-duplication is presentational, and it is sound rather than a guess:
        the catalogue is fetched with the stored credential, so while the
        integration is disconnected it CANNOT be degraded for any other reason.
        Once connected, a genuinely different catalogue failure — unreachable
        provider, partial lists — still gets its own banner below.

        No detection logic changed. Both facts are computed exactly as before;
        only one of them is now allowed to speak at a time.
      */}
      {!connection.connected ? (
        <div className="card vac-banner">
          <AlertTriangle size={16} aria-hidden="true" />
          <div className="vac-banner__body">
            <p>
              The voice integration isn&apos;t connected yet, so no calls are being placed. You can
              still configure and save this agent now — it will start working as soon as the
              integration is connected.
            </p>
            {/*
              An immediate next step, in the banner that reports the problem. The
              label says "integration" rather than naming the provider: this page
              stays provider-neutral in its copy, and the card it lands on is
              titled with the provider anyway.
            */}
            <Link className="text-link" href="/settings/integrations">
              Connect the integration
              <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </div>
        </div>
      ) : (
        catalog.degraded &&
        catalog.reason && (
          <div className="card vac-banner">
            <AlertTriangle size={16} aria-hidden="true" />
            <div className="vac-banner__body">
              <p>{catalog.reason}</p>
            </div>
          </div>
        )
      )}

      {/* --- 1. General --------------------------------------------------- */}
      <ConsoleSection
        id="general"
        title="General"
        description="What this agent is called, what it is for, and the number candidates see."
      >
        <div className="vac-grid">
          <div className="vac-field">
            <label className="label" htmlFor="vac-name">
              Agent name
            </label>
            <input
              id="vac-name"
              className="input"
              type="text"
              maxLength={LIMITS.nameMax}
              value={draft.general.name}
              onChange={(event) => patch("general", { name: event.target.value })}
            />
          </div>

          <div className="vac-field">
            <label className="label" htmlFor="vac-purpose">
              Purpose
            </label>
            <div className="select is-fullwidth">
              <select
                id="vac-purpose"
                value={draft.general.purpose}
                onChange={(event) =>
                  patch("general", { purpose: event.target.value as AgentPurpose })
                }
              >
                {AGENT_PURPOSES.map((purpose) => (
                  <option key={purpose} value={purpose}>
                    {PURPOSE_LABELS[purpose]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="vac-field">
            <label className="label" htmlFor="vac-company">
              Company name
            </label>
            <p className="stage-field__help">
              What the agent says out loud. Prefilled from your organization ({organizationName}).
            </p>
            <input
              id="vac-company"
              className="input"
              type="text"
              maxLength={LIMITS.companyNameMax}
              value={draft.general.companyName ?? ""}
              onChange={(event) =>
                patch("general", { companyName: event.target.value || null })
              }
            />
          </div>

          <div className="vac-field">
            <label className="label" htmlFor="vac-caller">
              Default caller number
            </label>
            <p className="stage-field__help">The number this agent calls from.</p>
            <input
              id="vac-caller"
              className={`input${callerNumberValid ? "" : " is-danger"}`}
              type="tel"
              placeholder="+91 98765 43210"
              value={draft.general.callerNumber ?? ""}
              onChange={(event) =>
                patch("general", { callerNumber: event.target.value || null })
              }
              /*
                The dial code is added on BLUR, not on every keystroke — prefixing
                mid-typing moves the caret and fights the person entering the
                number. Only a bare national-length number is touched: anything
                already carrying a "+" or a leading trunk "0" is left exactly as
                typed, because guessing a country for a number that states one is
                how a call reaches a stranger.
              */
              onBlur={(event) => {
                const next = withDialCode(event.target.value);
                if (next !== event.target.value) patch("general", { callerNumber: next });
              }}
            />
            {!callerNumberValid && (
              <p className="stage-warning">
                That doesn&apos;t look like a dialable number — 8 to 15 digits, with the country
                code. Leave it empty to use the account&apos;s own number.
              </p>
            )}
          </div>
        </div>
      </ConsoleSection>

      {/* --- 2. Greeting -------------------------------------------------- */}
      <ConsoleSection
        id="greeting"
        title="Greeting"
        description="The first and last thing a candidate hears from this agent."
      >
        {/*
          The consent disclosure comes BEFORE the welcome message on every call and
          is not editable here. Said plainly, because an admin who does not know
          that will write their own disclosure into the welcome and the candidate
          will hear it twice.
        */}
        <div className="vac-callout">
          <CircleDot size={15} aria-hidden="true" />
          <p>
            Every call opens with the required disclosure — that it is automated, may be recorded,
            and can be ended — before this welcome message. That opening cannot be edited or
            switched off.
          </p>
        </div>

        <PlaceholderEditor
          id="vac-welcome"
          label="Welcome message"
          help="Said after the disclosure."
          rows={4}
          value={draft.greeting.welcomeMessage}
          onChange={(welcomeMessage) => patch("greeting", { welcomeMessage })}
        />

        <PlaceholderEditor
          id="vac-closing"
          label="Closing message"
          help="How the agent signs off."
          rows={4}
          value={draft.greeting.closingMessage}
          onChange={(closingMessage) => patch("greeting", { closingMessage })}
        />
      </ConsoleSection>

      {/* --- 3. AI Brain -------------------------------------------------- */}
      <ConsoleSection
        id="brain"
        title="AI Brain"
        description="Who the agent is, how it speaks, and the rules it must not break."
      >
        <PlaceholderEditor
          id="vac-persona"
          label="Persona"
          help="Who the agent is being. A sentence or two."
          rows={3}
          value={draft.brain.persona}
          onChange={(persona) => patch("brain", { persona })}
        />

        <div className="vac-grid">
          <div className="vac-field">
            <label className="label" htmlFor="vac-tone">
              Tone
            </label>
            <div className="select is-fullwidth">
              <select
                id="vac-tone"
                value={draft.brain.tone}
                onChange={(event) => patch("brain", { tone: event.target.value as AgentTone })}
              >
                {AGENT_TONES.map((tone) => (
                  <option key={tone} value={tone}>
                    {tone.charAt(0).toUpperCase() + tone.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="vac-field">
            <label className="label" htmlFor="vac-length">
              Response length
            </label>
            <div className="select is-fullwidth">
              <select
                id="vac-length"
                value={draft.brain.responseLength}
                onChange={(event) =>
                  patch("brain", { responseLength: event.target.value as ResponseLength })
                }
              >
                {RESPONSE_LENGTHS.map((length) => (
                  <option key={length} value={length}>
                    {length.charAt(0).toUpperCase() + length.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <CatalogSelect
            id="vac-model"
            label="Model"
            hint="Options come from the provider, so new ones appear here without a release."
            options={catalog.models}
            value={draft.brain.modelKey}
            onChange={(modelKey) => patch("brain", { modelKey })}
            degraded={catalog.degraded}
          />

          <Slider
            id="vac-temperature"
            label="Temperature"
            hint="Lower is more predictable. Screening calls usually want low."
            min={LIMITS.temperatureMin}
            max={LIMITS.temperatureMax}
            step={0.05}
            value={draft.brain.temperature}
            onChange={(temperature) => patch("brain", { temperature })}
            format={(value) => value.toFixed(2)}
          />
        </div>

        {/*
          AI Edit sits ABOVE the field rather than absolutely positioned inside
          PlaceholderEditor's header. That header already holds "Insert field" and
          its picker menu; adding a second control into a shared component used by
          three other screens would have changed all of them.
        */}
        <PromptAiEdit
          agentId={active.id}
          currentPrompt={draft.brain.systemPrompt}
          // Writes into the FORM only. Persisting still needs the page's Save, so
          // an accepted revision is as reversible as any other edit.
          onAccept={(systemPrompt) => patch("brain", { systemPrompt })}
        />

        <PlaceholderEditor
          id="vac-prompt"
          label="Base instructions"
          help="How the agent should run the conversation. A job's own script, if it has one, is added to this."
          rows={8}
          value={draft.brain.systemPrompt}
          onChange={(systemPrompt) => patch("brain", { systemPrompt })}
        />

        {/* The same repeatable-list control the screening/assessment question
            lists use — reordering matters here, because the last rule in a long
            prompt carries the most weight. */}
        <StringListEditor
          label="Guardrails"
          help="Things the agent must never do. Sent as hard rules at the end of the instructions."
          items={draft.brain.guardrails}
          onChange={(guardrails) => patch("brain", { guardrails })}
          placeholder="e.g. Never state or imply a hiring decision."
        />
      </ConsoleSection>

      {/* --- 4. Voice ----------------------------------------------------- */}
      <ConsoleSection id="voice" title="Voice" description="How the agent sounds.">
        <CatalogSelect
          id="vac-voice"
          label="Voice"
          hint="Names and languages only."
          options={catalog.voices}
          value={draft.voice.voiceKey}
          onChange={(voiceKey) => patch("voice", { voiceKey })}
          degraded={catalog.degraded}
        />
      </ConsoleSection>

      {/* --- 5. Speech recognition ---------------------------------------- */}
      <ConsoleSection
        id="speech"
        title="Speech Recognition"
        description="How the agent understands what the candidate says."
      >
        <CatalogSelect
          id="vac-stt"
          label="Recognition model and language"
          options={catalog.stt}
          value={draft.speech.sttKey}
          onChange={(sttKey) => patch("speech", { sttKey })}
          degraded={catalog.degraded}
        />
      </ConsoleSection>

      {/* --- 6. Conversation behaviour ------------------------------------ */}
      <ConsoleSection
        id="behavior"
        title="Conversation Behavior"
        description="How the agent handles interruptions, silence and the end of a call."
      >
        <ToggleRow
          id="vac-interrupt"
          label="Allow interruption"
          hint="The agent stops talking when the candidate starts."
          checked={draft.behavior.allowInterruption}
          onChange={(allowInterruption) => patch("behavior", { allowInterruption })}
        >
          <Slider
            id="vac-interrupt-sensitivity"
            label="Interruption sensitivity"
            hint="Higher stops sooner. Very high can be triggered by background noise."
            min={LIMITS.interruptionMin}
            max={LIMITS.interruptionMax}
            step={0.1}
            value={draft.behavior.interruptionSensitivity}
            onChange={(interruptionSensitivity) => patch("behavior", { interruptionSensitivity })}
            format={(value) => `${Math.round(value * 100)}%`}
          />
        </ToggleRow>

        <ToggleRow
          id="vac-backchannel"
          label="Backchanneling"
          hint={'Small acknowledgements — "mm-hm", "I see" — while the candidate speaks.'}
          checked={draft.behavior.backchanneling}
          onChange={(backchanneling) => patch("behavior", { backchanneling })}
        />

        <ToggleRow
          id="vac-ambience"
          label="Background ambience"
          hint="Quiet room noise, so the line doesn't sound dead."
          checked={draft.behavior.ambienceEnabled}
          onChange={(ambienceEnabled) => patch("behavior", { ambienceEnabled })}
        >
          <CatalogSelect
            id="vac-ambience-track"
            label="Ambience track"
            options={catalog.ambience}
            value={draft.behavior.ambienceTrackKey}
            onChange={(ambienceTrackKey) => patch("behavior", { ambienceTrackKey })}
            degraded={catalog.degraded}
            placeholder="Pick a track"
          />
        </ToggleRow>

        <div className="vac-grid">
          <NumberField
            id="vac-silence"
            label="Hang up after silence"
            hint="How long a silence before the agent ends the call."
            min={LIMITS.silenceSecondsMin}
            max={LIMITS.silenceSecondsMax}
            unit="seconds"
            value={draft.behavior.maxSilenceSeconds}
            onChange={(maxSilenceSeconds) => patch("behavior", { maxSilenceSeconds })}
          />

          <NumberField
            id="vac-duration"
            label="Max call duration"
            hint="A hard ceiling. The call ends here whatever is happening."
            min={LIMITS.callMinutesMin}
            max={LIMITS.callMinutesMax}
            unit="minutes"
            value={draft.behavior.maxCallMinutes}
            onChange={(maxCallMinutes) => patch("behavior", { maxCallMinutes })}
          />
        </div>

        <ToggleRow
          id="vac-ai-hangup"
          label="Let the agent decide when to hang up"
          hint="The agent ends the call once it judges the conversation finished."
          checked={draft.behavior.aiDecidedHangup}
          onChange={(aiDecidedHangup) => patch("behavior", { aiDecidedHangup })}
        />

        <ToggleRow
          id="vac-voicemail"
          label="Voicemail detection"
          hint="Recognises an answering machine and hangs up instead of talking to it."
          checked={draft.behavior.voicemailDetection}
          onChange={(voicemailDetection) => patch("behavior", { voicemailDetection })}
        />

        <ToggleRow
          id="vac-unknown"
          label="Reject unknown callers"
          /*
            Said honestly. This product only places outbound calls today, so there
            is no inbound path for this to gate — and a toggle that silently does
            nothing is worse than one that says what it is waiting for.
          */
          hint="Stored for when inbound calling is enabled. This agent only places outbound calls today, so nothing can reach it inbound."
          checked={draft.behavior.rejectUnknownCallers}
          onChange={(rejectUnknownCallers) => patch("behavior", { rejectUnknownCallers })}
        />
      </ConsoleSection>

      {/* --- 7. Default call data ---------------------------------------- */}
      <ConsoleSection
        id="calldata"
        title="Default Call Data"
        description="Organization-wide fallbacks for the AI screening call."
      >
        <CallDataSection
          callData={draft.callData}
          onChange={(callData: DefaultCallData) =>
            setDraft((current) => (current === null ? current : { ...current, callData }))
          }
          jobs={jobs}
          agentSystemPrompt={draft.brain.systemPrompt}
          agentCompanyName={draft.general.companyName}
        />
      </ConsoleSection>

      {/* --- 8. Human handoff -------------------------------------------- */}
      <ConsoleSection
        id="handoff"
        title="Human Handoff"
        description="Where to send a candidate who asks for a person."
      >
        <ToggleRow
          id="vac-transfer"
          label="Enable transfer to a person"
          hint="Needs a number. Without one, the transfer would drop the call."
          checked={draft.handoff.transferEnabled}
          onChange={(transferEnabled) => patch("handoff", { transferEnabled })}
        >
          <div className="vac-field">
            <label className="label" htmlFor="vac-transfer-number">
              Transfer number
            </label>
            <input
              id="vac-transfer-number"
              className="input"
              type="tel"
              placeholder="+91 98765 43210"
              value={draft.handoff.transferNumber ?? ""}
              onChange={(event) =>
                patch("handoff", { transferNumber: event.target.value || null })
              }
            />
            {draft.handoff.transferEnabled && !draft.handoff.transferNumber && (
              <p className="stage-warning">
                Add a number, or transfer stays off — it can&apos;t be saved on without one.
              </p>
            )}
          </div>
        </ToggleRow>
      </ConsoleSection>

      {/* --- 9. Test agent ----------------------------------------------- */}
      <ConsoleSection
        id="test"
        title="Test Agent"
        description="Call yourself and hear what a candidate would hear, or rehearse the prompt in text."
        open={testOpen}
        onToggle={setTestOpen}
      >
        <TestAgentSection
          key={active.id}
          agentId={active.id}
          controller={testCall}
          // The DRAFT, not the saved row: Chat exists to rehearse edits before
          // committing them, which is the one thing a real call cannot do.
          settings={draft}
          mode={testMode}
          onModeChange={setTestMode}
          connected={connection.connected}
          synced={active.synced}
          hasUnsavedChanges={dirty}
        />
      </ConsoleSection>

      {/* --- Danger zone -------------------------------------------------- */}
      {agents.length > 1 && (
        <div className="card vac-danger">
          <div>
            <p className="label">Delete this agent</p>
            <p className="stage-field__help">
              {active.isDefault
                ? "This is the default agent. Deleting it promotes another one, so calls keep working."
                : "Calls using the default agent are unaffected."}
            </p>
          </div>
          {confirmingDelete ? (
            <div className="buttons">
              <Button size="small" variant="danger" icon={Trash2} onClick={deleteAgent}>
                Delete permanently
              </Button>
              <Button size="small" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="small" variant="danger" onClick={() => setConfirmingDelete(true)}>
              Delete agent
            </Button>
          )}
        </div>
      )}

      {/* --- Sticky save -------------------------------------------------- */}
      <div className="vac-savebar">
        <div className="vac-savebar__inner">
          <div className="vac-savebar__status">
            {dirty && (
              <span className="vac-savebar__dot" aria-live="polite">
                <span className="vac-savebar__dot-mark" aria-hidden="true" />
                Unsaved changes
              </span>
            )}

            {!dirty && saveState.kind === "saved" && (
              <span className="vac-savebar__saved" role="status">
                <Check size={14} aria-hidden="true" />
                Agent settings saved.
              </span>
            )}

            {saveState.kind === "saved_unsynced" && (
              <span className="vac-savebar__warn" role="status">
                <AlertTriangle size={14} aria-hidden="true" />
                Saved here, but not sent to the provider: {saveState.message}
              </span>
            )}

            {saveState.kind === "error" && (
              <span className="vac-savebar__error" role="alert">
                <AlertTriangle size={14} aria-hidden="true" />
                {saveState.message}
              </span>
            )}

            {!dirty && saveState.kind === "idle" && !active.synced && active.syncError && (
              <span className="vac-savebar__warn">
                <AlertTriangle size={14} aria-hidden="true" />
                The provider doesn&apos;t have these settings yet. Save again to retry.
              </span>
            )}
          </div>

          {/*
            SAVE IS SOLID PRIMARY THE MOMENT THERE IS ANYTHING TO SAVE.

            It looked washed-out on arrival because `!dirty` disables it and the
            only disabled treatment in the stylesheet is a global opacity
            knock-down — so a primary button at 55% opacity read as "you can't
            save", directly contradicting the banner above it, which says these
            settings can be saved now. Both statements were true of different
            things; only one was legible.

            Two fixes, no change to WHEN saving is allowed:

              1. The disabled state is grey (`is-unavailable`) rather than pale
                 primary, so it reads as inert instead of as a faded action —
                 the same treatment the Integrations page now uses.
              2. It says WHY, on hover and to a screen reader. "Nothing to save"
                 and "nothing is connected" are different facts and must not look
                 the same.

            `connection.connected` is deliberately NOT part of this condition. A
            disconnected integration does not stop a save, and the banner promises
            it does not.
          */}
          <Button
            variant="primary"
            className={saveDisabled ? "is-unavailable" : ""}
            loading={saveState.kind === "saving"}
            disabled={saveDisabled}
            title={
              !callerNumberValid
                ? "Fix the default caller number before saving."
                : saveDisabled
                  ? "No changes to save yet — edit any field to enable this."
                  : "Saves every section on this page in one request."
            }
            onClick={save}
          >
            Save agent
          </Button>
        </div>
      </div>
    </div>
  );
}
