"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmptyState, FormError } from "@/components/states";
import type { NotificationWithDelivery } from "@/lib/notifications/queries";
import { formatDateTimeInZone } from "@/lib/time";
import { Bell } from "lucide-react";

function formatWhen(value: string, timeZone: string) {
  // timeZone pinned as well as locale: without it the server formats in its own
  // zone (UTC in production) and the browser in the viewer's, which is a
  // hydration mismatch that only appears once deployed.
  return formatDateTimeInZone(value, timeZone);
}

/**
 * Email delivery status, shown only when it says something a reader can act on.
 *
 * `sent` deliberately renders nothing. A green tick on every message is noise,
 * and the useful signal — "this did NOT reach their inbox" — gets lost in it.
 */
function DeliveryNote({ notification }: { notification: NotificationWithDelivery }) {
  if (!notification.emailStatus || notification.emailStatus === "sent") return null;

  const isSkipped = notification.emailStatus === "skipped";

  return (
    <p
      style={{
        fontSize: 12,
        margin: "4px 0 0",
        color: isSkipped ? "var(--color-secondary-text)" : "var(--color-error)",
      }}
    >
      {isSkipped ? "Not emailed" : "Email failed"}
      {notification.emailDetail ? ` — ${notification.emailDetail}` : ""}
    </p>
  );
}

export function NotificationList({
  notifications,
  timeZone,
}: {
  notifications: NotificationWithDelivery[];
  /** The ORGANIZATION's timezone, so dates read the same on server and client. */
  timeZone: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Optimistic, so the list doesn't jump while a request is in flight.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = notifications.filter((notification) => !dismissed.has(notification.id));

  async function setRead(id: string, read: boolean) {
    setError(null);
    try {
      const response = await fetch(`/api/notifications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read }),
      });
      if (!response.ok) {
        const payload = await response.json();
        setError(payload.error ?? "Couldn't update that.");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the server.");
    }
  }

  async function dismiss(id: string) {
    setError(null);
    setDismissed((previous) => new Set(previous).add(id));

    try {
      const response = await fetch(`/api/notifications/${id}`, { method: "DELETE" });
      if (!response.ok) {
        // Put it back — a failed dismiss that leaves the row hidden would look
        // like it worked, and the alert would be lost until a reload.
        setDismissed((previous) => {
          const next = new Set(previous);
          next.delete(id);
          return next;
        });
        setError("Couldn't dismiss that.");
        return;
      }
      router.refresh();
    } catch {
      setDismissed((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
      setError("Couldn't reach the server.");
    }
  }

  async function markAllRead() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/notifications", { method: "PATCH" });
      if (!response.ok) {
        setError("Couldn't mark those as read.");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (visible.length === 0) {
    return <EmptyState headline="You're all caught up"
            message="Notifications appear here as work needs your attention."
            icon={Bell} />;
  }

  const unreadCount = visible.filter((notification) => !notification.read_at).length;

  return (
    <>
      {unreadCount > 0 && (
        <div className="is-flex is-justify-content-space-between is-align-items-center mb-4">
          <p className="has-text-secondary" style={{ fontSize: 13 }}>
            {unreadCount} unread
          </p>
          <button
            type="button"
            className={`button is-small ${busy ? "is-loading" : ""}`}
            onClick={markAllRead}
            disabled={busy}
          >
            Mark all read
          </button>
        </div>
      )}

      <FormError message={error} />

      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {visible.map((notification) => {
          const unread = !notification.read_at;

          return (
            <li
              key={notification.id}
              style={{
                borderTop: "1px solid var(--color-border)",
                padding: "12px 0",
                display: "flex",
                gap: "0.75rem",
              }}
            >
              {/* Unread dot, plus a warning colour for the high-priority types
                  that cannot be muted — those are the ones that mean somebody
                  has to do something. */}
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  marginTop: 6,
                  flexShrink: 0,
                  background: unread
                    ? notification.priority === "high"
                      ? "var(--color-warning)"
                      : "var(--color-primary)"
                    : "transparent",
                  border: unread ? "none" : "1px solid var(--color-border)",
                }}
              />

              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: unread ? 600 : 400, margin: 0 }}>
                  {notification.link_path ? (
                    <Link href={notification.link_path}>{notification.title}</Link>
                  ) : (
                    notification.title
                  )}
                </p>
                <p style={{ fontSize: 14, margin: "2px 0 0" }}>{notification.body}</p>
                <p className="has-text-secondary" style={{ fontSize: 12, margin: "4px 0 0" }}>
                  {formatWhen(notification.created_at, timeZone)}
                </p>
                <DeliveryNote notification={notification} />
              </div>

              <div className="buttons" style={{ flexShrink: 0 }}>
                <button
                  type="button"
                  className="button is-small"
                  onClick={() => setRead(notification.id, unread)}
                >
                  {unread ? "Mark read" : "Unread"}
                </button>
                <button
                  type="button"
                  className="button is-small"
                  onClick={() => dismiss(notification.id)}
                >
                  Dismiss
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
