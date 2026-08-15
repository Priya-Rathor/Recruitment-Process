// Attention queue — "what needs a human decision right now", most urgent first.
import Link from "next/link";
import { EmptyState, ErrorState } from "@/components/states";
import type { AttentionItem } from "@/lib/dashboard/metrics";
import { CheckCircle2 } from "lucide-react";

const SEVERITY_COLOR: Record<AttentionItem["severity"], string> = {
  error: "var(--color-error)",
  warning: "var(--color-warning)",
  info: "var(--color-info)",
};

export function AttentionQueue({
  items,
  status,
}: {
  items: AttentionItem[];
  status: "ok" | "pending" | "error";
}) {
  return (
    <div className="card dash-card">
      <h2 className="dash-card__title">Needs attention</h2>

      {/* An empty queue and a failed query must never look the same: telling a
          recruiter "nothing needs attention" when the query broke is a false
          statement, not a degraded one. */}
      {status === "error" ? (
        <ErrorState message="Couldn't check what needs attention. This list may be incomplete — reload to try again." />
      ) : status === "pending" ? (
        <EmptyState message="The attention queue starts working once Applications (Module 5) exists — that's where stalled work is detected." />
      ) : items.length === 0 ? (
        <EmptyState
          headline="Nothing needs you"
          message="You're all caught up — check back after your team adds candidates or jobs."
          icon={CheckCircle2}
          compact
        />
      ) : (
        <ul>
          {items.map((item) => (
            <li
              key={item.id}
              className="py-3"
              style={{ borderBottom: "1px solid var(--color-border)" }}
            >
              <div className="is-flex is-justify-content-space-between is-align-items-flex-start">
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontWeight: 600, fontSize: 14 }}>
                    {/* Link target belongs to Module 5; harmless until it exists. */}
                    {item.href ? <Link href={item.href}>{item.title}</Link> : item.title}
                  </p>
                  <p className="has-text-secondary" style={{ fontSize: 13 }}>
                    {item.detail}
                  </p>
                </div>
                <span
                  className="tag is-light ml-3"
                  style={{ color: SEVERITY_COLOR[item.severity], flexShrink: 0 }}
                >
                  {item.ageDays}d
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
