// =============================================================================
// The WhatsApp inbox's decisions, tested where they are pure.
//
// WHAT IS AND IS NOT COVERED HERE, deliberately.
//
// Covered: every rule that decides something irreversible or user-visible from
// data alone — whether a message is an opt-out, whether a thread can be replied
// to, what a real Meta payload contains, and whether a signature is valid.
// These are the decisions; lib/messaging/inbound.ts is the executor that does
// what it is told, which is the split AGENTS.md asks for precisely so the
// decisions can be tested without a database.
//
// Not covered: the Supabase round trips. This repository has no database
// fixture and mocking PostgREST would test the mock. The behaviours that depend
// on them — the dedupe index, the unique thread constraint, the RLS policies —
// are enforced by the SCHEMA rather than by TypeScript, which is the point of
// putting them there, and they are exercised by supabase/tests/replay.sh and by
// the manual checklist in docs/modules/15-testing-guide.md.
// =============================================================================
import { afterEach, describe, expect, it } from "vitest";
import {
  filterConversations,
  formatPhoneForDisplay,
  hoursLeftInWindow,
  isOptOutReply,
  isWithinServiceWindow,
  previewOf,
  replyCapability,
  type ConversationSummary,
} from "@/lib/messaging/conversations";
import {
  matchesSignature,
  parseWebhookPayload,
  webhookHandshakeMatches,
} from "@/lib/integrations/whatsapp";

// -----------------------------------------------------------------------------
// Opt-out detection
// -----------------------------------------------------------------------------
describe("STOP detection", () => {
  it("honours the words a candidate actually uses to opt out", () => {
    for (const word of [
      "STOP",
      "stop",
      "Stop.",
      "  STOP  ",
      "stop!",
      "UNSUBSCRIBE",
      "opt out",
      "OPTOUT",
      "stop all",
    ]) {
      expect(isOptOutReply(word), word).toBe(true);
    }
  });

  it("does not opt somebody out for using the word in a sentence", () => {
    /*
      The failure this prevents is silent and hard to undo: the candidate keeps
      talking, the product stops answering, and nothing in the thread says why.
      The unsubscribe token cannot re-subscribe anyone, so only a recruiter
      noticing can put it back.
    */
    for (const sentence of [
      "Please stop by the office at 3",
      "I had to stop the interview early, sorry",
      "Can you stop sending these to my work number and use this one?",
      "non-stop travel in my last role",
    ]) {
      expect(isOptOutReply(sentence), sentence).toBe(false);
    }
  });

  it("leaves CANCEL, END and QUIT alone, unlike the conventional list", () => {
    // All three are plausible answers to "shall I book you in for Thursday?".
    // See OPT_OUT_WORDS for the reasoning.
    for (const word of ["cancel", "END", "quit"]) {
      expect(isOptOutReply(word), word).toBe(false);
    }
  });

  it("ignores an empty or whitespace-only message", () => {
    expect(isOptOutReply("")).toBe(false);
    expect(isOptOutReply("   ")).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Meta's 24-hour customer service window
// -----------------------------------------------------------------------------
describe("the 24-hour window", () => {
  const now = new Date("2026-09-20T12:00:00Z");
  const hoursAgo = (hours: number) =>
    new Date(now.getTime() - hours * 3_600_000).toISOString();

  it("is open inside 24 hours of the candidate's last message", () => {
    expect(isWithinServiceWindow(hoursAgo(1), now)).toBe(true);
    expect(isWithinServiceWindow(hoursAgo(23.9), now)).toBe(true);
  });

  it("is closed at and after 24 hours", () => {
    expect(isWithinServiceWindow(hoursAgo(24), now)).toBe(false);
    expect(isWithinServiceWindow(hoursAgo(72), now)).toBe(false);
  });

  it("is closed when the candidate has never written to us", () => {
    // The normal state of a recruitment pipeline, and the reason the Meta
    // template path exists at all.
    expect(isWithinServiceWindow(null, now)).toBe(false);
  });

  it("treats an unparseable timestamp as closed rather than open", () => {
    expect(isWithinServiceWindow("not a date", now)).toBe(false);
  });

  it("counts down the hours left", () => {
    expect(hoursLeftInWindow(hoursAgo(1), now)).toBe(23);
    expect(hoursLeftInWindow(hoursAgo(23.5), now)).toBe(0);
    expect(hoursLeftInWindow(null, now)).toBe(0);
  });
});

describe("replyCapability", () => {
  const now = new Date("2026-09-20T12:00:00Z");
  const recent = new Date(now.getTime() - 3_600_000).toISOString();
  const old = new Date(now.getTime() - 72 * 3_600_000).toISOString();

  const base = {
    metaTemplateConfigured: false,
    whatsappConnected: true,
    optedOut: false,
    now,
  };

  it("allows free-form text inside the window", () => {
    const capability = replyCapability({ ...base, lastInboundAt: recent });
    expect(capability).toMatchObject({ canReply: true, mode: "freeform" });
  });

  it("falls back to the approved Meta template outside the window", () => {
    const capability = replyCapability({
      ...base,
      lastInboundAt: old,
      metaTemplateConfigured: true,
    });
    expect(capability).toMatchObject({ canReply: true, mode: "template" });
    // The recruiter is told what will actually arrive on the phone.
    expect(capability.canReply && capability.note).toContain("approved WhatsApp template");
  });

  it("refuses outside the window with no template, and gives the remedy", () => {
    const capability = replyCapability({ ...base, lastInboundAt: old });
    expect(capability.canReply).toBe(false);
    // The same wording sendWhatsApp() produces on Meta's 131047, so hitting the
    // wall in two places does not look like two different problems.
    expect(capability.canReply === false && capability.reason).toContain(
      "approved WhatsApp template"
    );
  });

  it("refuses when the candidate has opted out, even inside the window", () => {
    const capability = replyCapability({ ...base, lastInboundAt: recent, optedOut: true });
    expect(capability.canReply).toBe(false);
    expect(capability.canReply === false && capability.reason).toContain("opted out");
  });

  it("refuses when WhatsApp is not connected, before anything else", () => {
    const capability = replyCapability({
      ...base,
      lastInboundAt: recent,
      whatsappConnected: false,
    });
    expect(capability.canReply).toBe(false);
    expect(capability.canReply === false && capability.reason).toContain("isn't connected");
  });

  it("warns as the window is about to close", () => {
    const capability = replyCapability({
      ...base,
      lastInboundAt: new Date(now.getTime() - 23 * 3_600_000).toISOString(),
    });
    expect(capability.canReply && capability.note).toContain("closes in under");
  });
});

// -----------------------------------------------------------------------------
// Meta's webhook payloads
// -----------------------------------------------------------------------------
describe("parseWebhookPayload", () => {
  const textMessage = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "919000000000", phone_number_id: "1234567890" },
              contacts: [{ profile: { name: "Rahul" }, wa_id: "919876543210" }],
              messages: [
                {
                  from: "919876543210",
                  id: "wamid.HBgMOTE5ODc2NTQzMjEwFQIAEhgg",
                  timestamp: "1758369600",
                  text: { body: "Yes, Thursday works for me" },
                  type: "text",
                },
              ],
            },
          },
        ],
      },
    ],
  };

  it("reads a text message and the business number it arrived on", () => {
    const { entries } = parseWebhookPayload(textMessage);

    expect(entries).toHaveLength(1);
    expect(entries[0].phoneNumberId).toBe("1234567890");
    expect(entries[0].messages).toEqual([
      {
        providerMessageId: "wamid.HBgMOTE5ODc2NTQzMjEwFQIAEhgg",
        from: "919876543210",
        body: "Yes, Thursday works for me",
        // Meta's seconds-since-epoch string, as an ISO instant.
        sentAt: "2025-09-20T12:00:00.000Z",
      },
    ]);
  });

  it("reads delivery and read receipts", () => {
    const { entries } = parseWebhookPayload({
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "1234567890" },
                statuses: [
                  { id: "wamid.OUT1", status: "delivered", timestamp: "1758369600" },
                  { id: "wamid.OUT2", status: "read", timestamp: "1758369601" },
                  { id: "wamid.OUT3", status: "failed", timestamp: "1758369602" },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(entries[0].statuses).toEqual([
      { providerMessageId: "wamid.OUT1", status: "delivered" },
      { providerMessageId: "wamid.OUT2", status: "read" },
      { providerMessageId: "wamid.OUT3", status: "failed" },
    ]);
  });

  it("counts non-text messages instead of storing a blank bubble", () => {
    const { entries, unsupportedMessages } = parseWebhookPayload({
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "1234567890" },
                messages: [
                  { from: "919876543210", id: "wamid.IMG", type: "image", image: { id: "x" } },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(unsupportedMessages).toBe(1);
    // Nothing to show and nothing to reply to, so no entry at all — but the
    // handler logs the count rather than letting it vanish.
    expect(entries).toHaveLength(0);
  });

  it("ignores changes that are not about messages", () => {
    // Template approvals, quality ratings and account updates all arrive on the
    // same webhook and none of them belongs in a candidate's thread.
    const { entries } = parseWebhookPayload({
      entry: [
        {
          changes: [
            {
              field: "message_template_status_update",
              value: { event: "APPROVED", message_template_name: "interview_reminder" },
            },
          ],
        },
      ],
    });

    expect(entries).toHaveLength(0);
  });

  it("survives every shape of junk without throwing", () => {
    /*
      A signature proves WHO sent the body, not that its shape matches the
      documentation. This handler is public, so a throw here would be a 500 that
      Meta retries forever.
    */
    for (const junk of [
      null,
      undefined,
      {},
      { entry: null },
      { entry: [{ changes: "nope" }] },
      { entry: [{ changes: [{ field: "messages", value: null }] }] },
      { entry: [{ changes: [{ field: "messages", value: { metadata: {} } }] }] },
      { entry: [{ changes: [{ field: "messages", value: { messages: [{}] } }] }] },
    ]) {
      expect(() => parseWebhookPayload(junk)).not.toThrow();
      expect(parseWebhookPayload(junk).entries).toEqual([]);
    }
  });

  it("caps a body at the provider's own message length", () => {
    const { entries } = parseWebhookPayload({
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "1234567890" },
                messages: [
                  {
                    from: "919876543210",
                    id: "wamid.LONG",
                    type: "text",
                    timestamp: "1758369600",
                    text: { body: "x".repeat(10_000) },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(entries[0].messages[0].body).toHaveLength(4096);
  });
});

// -----------------------------------------------------------------------------
// Display
// -----------------------------------------------------------------------------
describe("previews and formatting", () => {
  it("previews the first non-empty line", () => {
    expect(previewOf("\n\n  Hello there  \nsecond line")).toBe("Hello there");
  });

  it("truncates a long line with an ellipsis", () => {
    const preview = previewOf("y".repeat(400));
    expect(preview).toHaveLength(120);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("formats an Indian number the way an Indian recruiter reads it", () => {
    expect(formatPhoneForDisplay("919876543210")).toBe("+91 98765 43210");
  });

  it("spaces other numbers without inventing a country-code split", () => {
    // Deliberately NOT "+1 4155 552671": guessing where a country code ends
    // needs a numbering-plan database this project does not carry, and a wrong
    // guess would be printed as though it were a fact.
    expect(formatPhoneForDisplay("14155552671")).toBe("+1415 5552 671");
  });

  it("returns anything unexpected unchanged rather than mangling it", () => {
    expect(formatPhoneForDisplay("not-a-number")).toBe("not-a-number");
  });
});

describe("search", () => {
  const conversations: ConversationSummary[] = [
    {
      id: "a",
      candidate_id: "c1",
      candidate_name: "Rahul Sharma",
      phone_number: "919876543210",
      last_message_at: "2026-09-20T10:00:00Z",
      last_inbound_at: null,
      last_message_preview: "Hello",
      unread_count: 0,
      last_message_auto_replied: false,
      needs_human: false,
      needs_human_reason: null,
    },
    {
      id: "b",
      candidate_id: null,
      candidate_name: null,
      phone_number: "447700900123",
      last_message_at: "2026-09-19T10:00:00Z",
      last_inbound_at: null,
      last_message_preview: "Who is this?",
      unread_count: 2,
      last_message_auto_replied: false,
      needs_human: false,
      needs_human_reason: null,
    },
  ];

  it("matches on name, case-insensitively", () => {
    expect(filterConversations(conversations, "rahul").map((c) => c.id)).toEqual(["a"]);
  });

  it("matches a number however it is typed", () => {
    // The digits are compared with punctuation stripped, so a number copied off
    // a CV in any format finds the thread.
    expect(filterConversations(conversations, "+91 98765").map((c) => c.id)).toEqual(["a"]);
    expect(filterConversations(conversations, "447700").map((c) => c.id)).toEqual(["b"]);
  });

  it("finds an unmatched thread by number even though it has no name", () => {
    expect(filterConversations(conversations, "900123").map((c) => c.id)).toEqual(["b"]);
  });

  it("returns everything for an empty query", () => {
    expect(filterConversations(conversations, "  ")).toHaveLength(2);
  });
});

// -----------------------------------------------------------------------------
// Signature verification
//
// The one check standing between a public URL and a forged candidate message.
// A forged "STOP" would switch off a real candidate's messages, so "rejects
// anything unsigned" is tested as carefully as "accepts what Meta sent".
// -----------------------------------------------------------------------------
describe("X-Hub-Signature-256 verification", () => {
  const secret = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
  const body = JSON.stringify({ entry: [{ changes: [] }] });

  /** Meta's own construction: hex HMAC-SHA256 over the raw body, "sha256=" prefixed. */
  async function sign(payload: string, withSecret = secret): Promise<string> {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(withSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    const hex = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return `sha256=${hex}`;
  }

  it("accepts a correctly signed body", async () => {
    await expect(
      matchesSignature({ rawBody: body, header: await sign(body), secret })
    ).resolves.toBe(true);
  });

  it("accepts the header without Meta's prefix, and in either case", async () => {
    const header = await sign(body);
    const bare = header.replace("sha256=", "");

    await expect(matchesSignature({ rawBody: body, header: bare, secret })).resolves.toBe(true);
    await expect(
      matchesSignature({ rawBody: body, header: bare.toUpperCase(), secret })
    ).resolves.toBe(true);
  });

  it("rejects a MISSING signature", async () => {
    await expect(matchesSignature({ rawBody: body, header: null, secret })).resolves.toBe(false);
    await expect(matchesSignature({ rawBody: body, header: "", secret })).resolves.toBe(false);
  });

  it("rejects a signature made with a different secret", async () => {
    const header = await sign(body, "ffffffffffffffffffffffffffffffff");
    await expect(matchesSignature({ rawBody: body, header, secret })).resolves.toBe(false);
  });

  it("rejects a body altered after signing", async () => {
    // The attack this stops: a real event replayed with the message text
    // swapped, which is how somebody would put words in a candidate's mouth.
    const header = await sign(body);
    const tampered = JSON.stringify({ entry: [{ changes: [{ field: "messages" }] }] });
    await expect(matchesSignature({ rawBody: tampered, header, secret })).resolves.toBe(false);
  });

  it("rejects junk that is not a signature at all", async () => {
    for (const header of ["sha256=", "nonsense", "sha256=zzzz", "0".repeat(64)]) {
      await expect(matchesSignature({ rawBody: body, header, secret })).resolves.toBe(false);
    }
  });

  it("rejects everything when NO secret is configured", async () => {
    /*
      Fails closed. An endpoint that accepted unsigned events because nobody had
      set a secret would be an open write into a recruiter's inbox, and the
      symptom — messages appearing — looks like success.
    */
    const header = await sign(body);
    await expect(matchesSignature({ rawBody: body, header, secret: "" })).resolves.toBe(false);
  });
});

// -----------------------------------------------------------------------------
// The GET verification handshake
//
// Meta calls this once when the callback URL is saved, and the happy path is the
// hardest thing to exercise by hand: Next 16 refuses a second dev server in the
// same directory, so setting the env var locally means restarting the one that
// is running. That made it the single untested path after 0041 shipped — hence
// these.
// -----------------------------------------------------------------------------
describe("webhookHandshakeMatches", () => {
  const original = process.env.WHATSAPP_VERIFY_TOKEN;

  afterEach(() => {
    if (original === undefined) delete process.env.WHATSAPP_VERIFY_TOKEN;
    else process.env.WHATSAPP_VERIFY_TOKEN = original;
  });

  it("accepts the configured token", () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "a-chosen-verify-token";
    expect(webhookHandshakeMatches("a-chosen-verify-token")).toBe(true);
  });

  it("rejects a wrong token, a prefix and a superstring", () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "a-chosen-verify-token";

    for (const token of [
      "wrong",
      "a-chosen-verify-toke",
      "a-chosen-verify-tokenX",
      "A-CHOSEN-VERIFY-TOKEN",
      "",
      null,
    ]) {
      expect(webhookHandshakeMatches(token), String(token)).toBe(false);
    }
  });

  it("rejects everything when no token is configured", () => {
    /*
      Fails closed, and the route turns this into a 503 rather than a 403 — an
      UNCONFIGURED deployment is a different problem from a wrong token, and
      saying so is the difference between an operator checking their env vars and
      an operator checking Meta's dashboard.
    */
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    expect(webhookHandshakeMatches("anything")).toBe(false);
    expect(webhookHandshakeMatches("")).toBe(false);
  });

  it("rejects a whitespace-only configured token", () => {
    // Otherwise `WHATSAPP_VERIFY_TOKEN=" "` in a .env file would look set and
    // complete a handshake against a secret nobody meant to choose.
    process.env.WHATSAPP_VERIFY_TOKEN = "   ";
    expect(webhookHandshakeMatches("   ")).toBe(false);
  });
});
