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

type Variant = "primary" | "secondary" | "danger" | "ghost";

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
