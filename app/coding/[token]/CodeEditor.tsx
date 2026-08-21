"use client";

// =============================================================================
// The editor.
//
// CODEMIRROR 6, NOT MONACO, and the reason is the whole point of this feature.
//
// The candidate arrives by scanning a QR code with their phone. Monaco is
// several megabytes, assumes a mouse, and is effectively unusable on a small
// touch screen — an editor the intended entry path cannot open is not an
// editor. CodeMirror 6 is an order of magnitude smaller, handles touch, and has
// maintained grammars for the five languages lib/coding/languages.ts offers.
//
// LOADED DYNAMICALLY WITH ssr: false.
//
// Two reasons, both real. It touches `document` at module scope, so it cannot
// render on the server at all. And keeping it behind a dynamic boundary means
// none of it reaches the INTERVIEWER's bundle — the interview page, the monitor
// and the submission view all render code as plain text, and none of them
// should pay for an editor nobody there can type into.
// =============================================================================

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { Extension } from "@codemirror/state";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { sql } from "@codemirror/lang-sql";
import type { CodingLanguage } from "@/lib/coding/languages";

const CodeMirror = dynamic(() => import("@uiw/react-codemirror"), {
  ssr: false,
  // Shaped like the editor it replaces, so the page does not jump when it
  // arrives — the same rule the dashboard's skeleton follows.
  loading: () => <div className="coding-editor__placeholder">Loading the editor…</div>,
});

/**
 * Grammar per language.
 *
 * A plain lookup rather than a dynamic import per language: all five grammars
 * together are far smaller than the editor core they extend, and lazy-loading
 * them would put a visible flash of unhighlighted code in front of somebody who
 * has just switched language under time pressure.
 */
const GRAMMARS: Record<CodingLanguage, () => Extension> = {
  python: () => python(),
  javascript: () => javascript(),
  java: () => java(),
  cpp: () => cpp(),
  sql: () => sql(),
};

export function CodeEditor({
  value,
  language,
  onChange,
  readOnly = false,
}: {
  value: string;
  language: CodingLanguage;
  onChange: (next: string) => void;
  /** True after submission. The buffer stays readable; it stops being editable. */
  readOnly?: boolean;
}) {
  const extensions = useMemo(() => [GRAMMARS[language]?.() ?? python()], [language]);

  return (
    <div className="coding-editor">
      <CodeMirror
        value={value}
        height="100%"
        extensions={extensions}
        editable={!readOnly}
        readOnly={readOnly}
        onChange={onChange}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: !readOnly,
          highlightActiveLineGutter: !readOnly,
          foldGutter: false,
          // Off on purpose. A candidate being judged on their code should not be
          // wondering which of the suggestions was theirs, and an autocomplete
          // popup on a phone covers the line being typed.
          autocompletion: false,
          // Also off: a bracket the editor inserted is a bracket the candidate
          // then has to delete, which on a phone keyboard is genuinely annoying.
          closeBrackets: false,
          searchKeymap: false,
        }}
        aria-label="Code editor"
      />
    </div>
  );
}
