import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * The marketing button.
 *
 * A LINK OR A BUTTON, DECIDED BY WHETHER IT HAS AN `href` — and that is the
 * accessibility point, not a convenience. A control that navigates must be an
 * <a>: it has to open in a new tab on middle-click, appear in the browser's
 * link list, and be activated by Enter rather than Space. A <button> styled to
 * look like a link fails all three silently.
 *
 * WHY `variant` AND NOT A CLASS. The three variants are a hierarchy —
 * primary, secondary, tertiary — and a page should only ever have one primary
 * action in view. Naming them makes that legible when reading a section;
 * `className="mkt-btn mkt-btn--primary"` does not.
 *
 * THE INK ON A PRIMARY BUTTON IS NAVY, NOT WHITE, and that is settled in CSS
 * rather than here: white on the periwinkle fill is 2.49:1. See
 * --mkt-on-accent in marketing.scss.
 */
export type ButtonVariant = "primary" | "secondary" | "tertiary";

type CommonProps = {
  children: ReactNode;
  variant?: ButtonVariant;
  /** Trailing icon. Leading icons crowd the label at this size. */
  icon?: LucideIcon;
  size?: "md" | "sm";
  className?: string;
};

const CLASSES: Record<ButtonVariant, string> = {
  primary: "mkt-btn mkt-btn--primary",
  secondary: "mkt-btn mkt-btn--glass",
  tertiary: "mkt-btn mkt-btn--text",
};

function classesFor(variant: ButtonVariant, size: "md" | "sm", className: string) {
  return [CLASSES[variant], size === "sm" ? "mkt-btn--sm" : "", className]
    .filter(Boolean)
    .join(" ");
}

/*
  EVERY STYLING PROP IS DESTRUCTURED OUT OF `rest`, and that is a bug fix
  rather than a tidy-up.

  The first version pulled only `href`, `children` and `icon` off, then spread
  the remainder onto the element. `variant` and `size` are not HTML attributes,
  so React 19 passed them straight through and the rendered markup was
  `<a class="mkt-btn mkt-btn--glass" variant="secondary" href="...">` — invalid
  HTML on every button on the site.

  `className` was worse in a quieter way: `{...rest}` sat AFTER the computed
  `className`, so a caller passing one would have REPLACED the button's classes
  entirely and got an unstyled link, with nothing to explain why.

  It survived Module 01 because these primitives were written before anything
  called them; the first real caller (the solution band's CTA) surfaced both.
*/
export function ButtonLink({
  href,
  children,
  icon: Icon,
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: CommonProps & { href: string } & Omit<
    ComponentProps<typeof Link>,
    "href" | "className"
  >) {
  return (
    <Link href={href} className={classesFor(variant, size, className)} {...rest}>
      {children}
      {Icon && <Icon size={17} aria-hidden="true" />}
    </Link>
  );
}

export function Button({
  children,
  icon: Icon,
  type = "button",
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: CommonProps & Omit<ComponentProps<"button">, "className">) {
  return (
    <button type={type} className={classesFor(variant, size, className)} {...rest}>
      {children}
      {Icon && <Icon size={17} aria-hidden="true" />}
    </button>
  );
}
