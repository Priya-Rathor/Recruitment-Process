// =============================================================================
// Button.
//
// The audit found 115 raw <button> elements, each styling itself with Bulma
// classes plus inline overrides, and no pressed or loading state anywhere.
//
// The base geometry, hover, focus-visible, pressed and disabled treatments live
// in globals.scss so existing `.button` markup inherits them without being
// migrated. This component adds what CSS cannot: a real loading state with a
// spinner, and an icon slot with a fixed size.
// =============================================================================
"use client";

import type { ButtonHTMLAttributes, ComponentType, ReactNode } from "react";
import { Loader2 } from "lucide-react";

/**
 * "outline" was added for the Voice Agent Console's secondary actions.
 *
 * It maps to `.button.is-outlined-primary`, which the stylesheet already had:
 * white fill, primary border, primary text. Added as a NEW variant rather than
 * by changing what "secondary" renders — "secondary" is the default, so
 * redefining it would repaint every unstyled Button in the product at once.
 *
 * Worth knowing when choosing between them: "secondary" renders Bulma's
 * unmodified `.button`, which this theme paints near-black. For a real secondary
 * action beside a primary one, "outline" is almost always what is wanted.
 */
type Variant = "primary" | "secondary" | "outline" | "danger" | "ghost";

export function Button({
  children,
  variant = "secondary",
  size = "medium",
  loading = false,
  icon: Icon,
  className = "",
  disabled,
  ...rest
}: {
  children: ReactNode;
  variant?: Variant;
  size?: "small" | "medium";
  /**
   * Shows a spinner AND disables the button. A loading state that only greys
   * the label leaves the user unsure whether their click registered.
   */
  loading?: boolean;
  icon?: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const variantClass =
    variant === "primary"
      ? "is-primary"
      : variant === "outline"
        ? "is-outlined-primary"
        : variant === "danger"
          ? "is-danger"
          : variant === "ghost"
            ? "is-ghost"
            : "";

  const iconSize = size === "small" ? 14 : 16;

  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`button ${variantClass} ${size === "small" ? "is-small" : ""} ${className}`.trim()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2)",
        ...rest.style,
      }}
    >
      {loading ? (
        <Loader2
          size={iconSize}
          aria-hidden="true"
          style={{ animation: "spin 0.9s linear infinite", flexShrink: 0 }}
        />
      ) : (
        Icon && <Icon size={iconSize} aria-hidden />
      )}
      {children}
    </button>
  );
}
