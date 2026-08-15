// Shared timeline renderer. Used by /audit-log, /candidates/[id]/activity, and
// the entity detail pages — so one change to how an event reads applies
// everywhere, which is the point of the catalogue.
import { ENTITY_LABELS } from "@/lib/activity/types";
import type { ActivityRow } from "@/lib/activity/queries";

function formatWhen(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ActivityTimeline({
  events,
  showEntity = false,
}: {
  events: ActivityRow[];
  /** Show which record each event belongs to — useful on a mixed feed. */
  showEntity?: boolean;
}) {
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {events.map((event, index) => (
        <li
          key={event.id}
          style={{
            display: "flex",
            gap: "0.75rem",
            paddingBottom: index === events.length - 1 ? 0 : 16,
          }}
        >
          {/* A rail rather than icons: twelve entity types would need twelve
              icons, and a wall of them reads as decoration, not information. */}
          <div
            aria-hidden="true"
            style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                marginTop: 6,
                background: event.is_sensitive
                  ? "var(--color-warning)"
                  : "var(--color-primary)",
                flexShrink: 0,
              }}
            />
            {index !== events.length - 1 && (
              <span style={{ width: 1, flex: 1, background: "var(--color-border)", marginTop: 4 }} />
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, margin: 0 }}>{event.description}</p>
            <p
              className="has-text-secondary"
              style={{ fontSize: 12, margin: "2px 0 0" }}
            >
              {formatWhen(event.created_at)}
              {" · "}
              {/* "System" rather than a blank or an invented name: an automated
                  action genuinely had no human actor, and saying so is honest. */}
              {event.actor_name ?? event.actor_label ?? "System"}
              {showEntity ? ` · ${ENTITY_LABELS[event.entity_type] ?? event.entity_type}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
