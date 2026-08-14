// Attention queue — "what needs a human decision right now", most urgent first.
import Link from "next/link";
import { EmptyState } from "@/components/states";
import type { AttentionItem } from "@/lib/dashboard/metrics";

const SEVERITY_COLOR: Record<AttentionItem["severity"], string> = {
  error: "var(--color-error)",
  warning: "var(--color-warning)",
  info: "var(--color-info)",
};

export function AttentionQueue({
  items,
  pending,
}: {
  items: AttentionItem[];
  pending: boolean;
}) {
  return (
    <div className="card">
      <h2 className="title is-5">Needs attention</h2>

      {pending ? (
        <EmptyState message="The attention queue starts working once Applications (Module 5) exists — that's where stalled work is detected." />
      ) : items.length === 0 ? (
        <EmptyState message="Nothing is waiting on a decision right now." />
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
