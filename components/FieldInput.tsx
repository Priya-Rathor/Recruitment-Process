"use client";

// =============================================================================
// One form input, chosen by field type. SHARED.
//
// Extracted from app/apply/[token]/ApplyForm.tsx when Module 27 needed the same
// controls for custom fields on the job, candidate and application pages. It was
// moved rather than copied on purpose: two renderers for the same field_type
// vocabulary would drift, and the drift would show up as a dropdown that behaves
// one way on the public application form and another way on the job page — for
// the very same question, since a job field marked "show on public form" is
// rendered by both.
//
// The file-upload props are OPTIONAL because only the public form has a file
// field. Custom fields cannot be file_upload at all (excluded by
// CUSTOM_FIELD_TYPES and by migration 0039's CHECK), so that branch is
// unreachable for them and they pass nothing.
// =============================================================================
import { Paperclip } from "lucide-react";
import { RESUME_UPLOAD_ACCEPT } from "@/lib/resumes/uploadPolicy";
import type { FormFieldType } from "@/lib/forms/fields";

/**
 * The minimum a renderer needs.
 *
 * Structural, not an import of PublicField: the custom-fields caller builds this
 * from a CustomFieldDefinition, and tying the shared input to one module's row
 * type would drag that module's concerns into the other's page.
 */
export type FieldInputSpec = {
  fieldKey: string;
  fieldType: FormFieldType;
  options: string[];
};

/**
 * One input, chosen by field type.
 *
 * Native controls throughout — `type="tel"`, `type="date"`, a real `<select>` —
 * because on a phone those summon the right keyboard and the right picker, and
 * a hand-rolled component that looks nicer on a desktop is a worse form in the
 * place this page is actually used.
 */
export function FieldInput({
  field,
  value,
  onChange,
  fileInput,
  fileName,
  onFile,
}: {
  field: FieldInputSpec;
  value: string | string[] | boolean | undefined;
  onChange: (value: string | string[] | boolean) => void;
  fileInput?: React.RefObject<HTMLInputElement | null>;
  fileName?: string | null;
  onFile?: (name: string | null) => void;
}) {
  const id = `f-${field.fieldKey}`;
  const text = typeof value === "string" ? value : "";

  switch (field.fieldType) {
    case "long_text":
      return (
        <textarea
          id={id}
          className="textarea"
          rows={4}
          maxLength={5000}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case "dropdown":
      return (
        <div className="select is-fullwidth">
          <select id={id} value={text} onChange={(event) => onChange(event.target.value)}>
            <option value="">Choose one…</option>
            {field.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      );

    case "radio":
      return (
        <div className="apply-choices" role="radiogroup" aria-labelledby={id}>
          {field.options.map((option) => (
            <label key={option} className="apply-choice">
              <input
                type="radio"
                name={field.fieldKey}
                value={option}
                checked={text === option}
                onChange={() => onChange(option)}
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      );

    case "checkbox": {
      const chosen = Array.isArray(value) ? value : [];
      return (
        <div className="apply-choices">
          {field.options.map((option) => (
            <label key={option} className="apply-choice">
              <input
                type="checkbox"
                value={option}
                checked={chosen.includes(option)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...chosen, option]
                      : chosen.filter((item) => item !== option)
                  )
                }
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      );
    }

    case "yes_no":
      return (
        <div className="apply-choices">
          {[
            ["yes", "Yes"],
            ["no", "No"],
          ].map(([option, label]) => (
            <label key={option} className="apply-choice">
              <input
                type="radio"
                name={field.fieldKey}
                value={option}
                checked={text === option}
                onChange={() => onChange(option)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      );

    case "file_upload":
      return (
        <div className="apply-file">
          <input
            id={id}
            ref={fileInput}
            className="apply-file__input"
            type="file"
            accept={RESUME_UPLOAD_ACCEPT}
            onChange={(event) => onFile?.(event.target.files?.[0]?.name ?? null)}
          />
          <label className="button is-quiet apply-file__button" htmlFor={id}>
            <Paperclip size={14} aria-hidden="true" />
            {fileName ? "Change file" : "Choose file"}
          </label>
          <span className="apply-file__name">{fileName ?? "No file chosen"}</span>
        </div>
      );

    case "number":
      return (
        <input
          id={id}
          className="input"
          // "decimal" rather than "numeric": years of experience is 6.5 as often
          // as it is 6, and a keypad with no decimal point makes that untypeable.
          inputMode="decimal"
          type="number"
          step="any"
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    default:
      return (
        <input
          id={id}
          className="input"
          type={
            field.fieldType === "email"
              ? "email"
              : field.fieldType === "phone"
                ? "tel"
                : field.fieldType === "date"
                  ? "date"
                  : field.fieldType === "url"
                    ? "url"
                    : "text"
          }
          maxLength={field.fieldType === "url" ? 500 : 320}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}
