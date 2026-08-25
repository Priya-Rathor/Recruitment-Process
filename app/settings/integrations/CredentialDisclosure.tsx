import { Lock } from "lucide-react";

/**
 * The credential trust disclosure — ONE component, two placements.
 *
 * It appears as a footer note under every integration card, and again inside the
 * credential-entry panel of every connect flow. That second placement is the one
 * that matters: a promise about how a secret is handled is only reassuring at the
 * moment somebody is typing the secret, and the page footer is not where they are
 * looking then.
 *
 * Shared rather than written twice because the two copies would drift, and the
 * footer version is the one people quote back at you.
 */
const DISCLOSURE =
  "Credentials are encrypted before storage and can never be read back — not by this page, " +
  "not by the API, and not by anyone's browser session. Only the last four characters are kept " +
  "for display.";

export function CredentialDisclosure({
  /**
   * "footer" is the flat full-width note at the bottom of the page.
   * "inline" is the version inside a credential-entry panel.
   *
   * Same words either way. Only the frame differs — the footer stands alone and
   * needs a border to read as a distinct note, while the inline one already sits
   * inside a bordered panel and would look boxed-in-a-box with another.
   */
  placement,
}: {
  placement: "footer" | "inline";
}) {
  return (
    <p
      className={
        placement === "footer" ? "credential-note credential-note--footer" : "credential-note"
      }
    >
      <Lock size={13} aria-hidden="true" />
      <span>{DISCLOSURE}</span>
    </p>
  );
}
