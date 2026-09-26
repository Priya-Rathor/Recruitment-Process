"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import {
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  preferenceFrom,
  resolveTheme,
  type ThemePreference,
} from "@/lib/marketing/theme";

/*
  ONE STORE, NOT A PROVIDER. The header renders this twice (the bar and the
  mobile sheet); both read and write the same module-level preference, so a
  choice made in one is reflected in the other without a context wrapping the
  site. The resolved theme lives on <html data-mkt-theme>, which the inline
  script in the marketing layout set before first paint.
*/
const listeners = new Set<() => void>();
let current: ThemePreference | null = null;
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function read(): ThemePreference {
  if (current) return current;
  try {
    current = preferenceFrom(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    current = "light";
  }
  return current;
}

function apply(preference: ThemePreference) {
  document.documentElement.setAttribute(THEME_ATTRIBUTE, resolveTheme(preference, media().matches));
}

function onSystemChange() {
  if (read() === "system") apply("system");
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    media().addEventListener("change", onSystemChange);
    // A client-side navigation from the app into the website never re-runs the
    // head script, so the first toggle to mount re-applies the stored choice.
    apply(read());
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) media().removeEventListener("change", onSystemChange);
  };
}

function choose(preference: ThemePreference) {
  current = preference;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage blocked: the choice still applies for this page view.
  }
  apply(preference);
  listeners.forEach((listener) => listener());
}

const OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Switch to light theme", icon: Sun },
  { value: "system", label: "Use system theme", icon: Monitor },
  { value: "dark", label: "Switch to dark theme", icon: Moon },
];

export function ThemeToggle({ className = "" }: { className?: string }) {
  // The server knows no preference; "light" is the default it rendered, so the
  // first client render agrees with the HTML and nothing mismatches.
  const preference = useSyncExternalStore(subscribe, read, () => "light" as ThemePreference);

  return (
    <div className={`mkt-theme ${className}`} role="group" aria-label="Colour theme">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          className="mkt-theme__option"
          aria-label={label}
          aria-pressed={preference === value}
          title={label}
          onClick={() => choose(value)}
        >
          <Icon size={15} strokeWidth={1.9} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
