// =============================================================================
// Resume text extraction (PDF / DOCX / plain text).
//
// The spec's test is "parsing handles varied resume formats without failing
// outright (graceful partial results)". So every path here returns a RESULT
// rather than throwing, and partial text counts as success — half a resume
// still parses into useful fields.
//
// The failure that matters most is a scanned/image-only PDF: it extracts
// approximately nothing, and if we passed that to the model it would either
// hallucinate or return empty, and the recruiter would blame the AI. Detected
// explicitly and reported as its own reason, with OCR named as the fix
// (OCR at scale is Build Later per the spec).
// =============================================================================

export type ExtractionResult =
  | { ok: true; text: string; characters: number; truncated: boolean }
  | { ok: false; reason: ExtractionFailure; message: string };

export type ExtractionFailure =
  | "unsupported_type"
  | "empty_file"
  /** Parsed fine, but yielded too little text to be a resume — usually a scan. */
  | "no_text_layer"
  | "corrupt_file";

/** Beyond this, we send a prefix — resumes this long are almost always padded. */
export const MAX_EXTRACTED_CHARACTERS = 40_000;

/**
 * Minimum characters to treat as a real resume. A one-page CV runs to well over
 * a thousand; anything under this is a scan, a cover sheet, or a broken file.
 */
export const MIN_USEFUL_CHARACTERS = 120;

export const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
] as const;

export const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".doc", ".txt"] as const;

/** Normalises whitespace without destroying the line structure resumes rely on. */
export function normalizeExtractedText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    // Collapse runs of blank lines, which PDFs produce in quantity.
    .replace(/\n{3,}/g, "\n\n")
    // Collapse horizontal runs, including the non-breaking spaces PDFs emit.
    .replace(/[ \t ]{2,}/g, " ")
    .trim();
}

/** Decides how to extract, from the MIME type with a filename fallback. */
export function detectFileKind(
  fileName: string,
  mimeType: string | null
): "pdf" | "docx" | "text" | null {
  const lowerName = fileName.toLowerCase();
  const type = (mimeType ?? "").toLowerCase();

  if (type === "application/pdf" || lowerName.endsWith(".pdf")) return "pdf";
  if (
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lowerName.endsWith(".docx")
  ) {
    return "docx";
  }
  if (type === "text/plain" || lowerName.endsWith(".txt")) return "text";
  // Legacy .doc is binary and NOT handled by mammoth; treated as unsupported
  // rather than silently producing mojibake.
  return null;
}

/**
 * Extracts text from a resume file.
 *
 * Never throws: a bad file is a normal occurrence in recruitment, and the
 * manual workflow must remain usable.
 */
export async function extractResumeText({
  buffer,
  fileName,
  mimeType,
}: {
  buffer: ArrayBuffer;
  fileName: string;
  mimeType: string | null;
}): Promise<ExtractionResult> {
  if (buffer.byteLength === 0) {
    return { ok: false, reason: "empty_file", message: "That file is empty." };
  }

  const kind = detectFileKind(fileName, mimeType);
  if (!kind) {
    return {
      ok: false,
      reason: "unsupported_type",
      message: "Upload a PDF, DOCX, or plain-text file. Older .doc files aren't supported.",
    };
  }

  let raw: string;
  try {
    if (kind === "pdf") {
      // unpdf bundles a serverless-friendly build of pdf.js.
      const { extractText, getDocumentProxy } = await import("unpdf");
      const document = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(document, { mergePages: true });
      raw = Array.isArray(text) ? text.join("\n") : text;
    } else if (kind === "docx") {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({
        buffer: Buffer.from(buffer),
      });
      raw = value;
    } else {
      raw = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    }
  } catch (error) {
    console.error(`[resumes] extraction failed for ${kind}:`, error);
    return {
      ok: false,
      reason: "corrupt_file",
      message: "That file couldn't be read. It may be corrupted or password-protected.",
    };
  }

  const text = normalizeExtractedText(raw ?? "");

  if (text.length < MIN_USEFUL_CHARACTERS) {
    // Almost always a scanned image. Say so plainly, and give the recruiter a
    // route forward rather than a dead end.
    return {
      ok: false,
      reason: "no_text_layer",
      message:
        "We couldn't find readable text in that file — it looks like a scan or an image. " +
        "Upload a text-based version, or enter the details manually.",
    };
  }

  const truncated = text.length > MAX_EXTRACTED_CHARACTERS;

  return {
    ok: true,
    text: truncated ? text.slice(0, MAX_EXTRACTED_CHARACTERS) : text,
    characters: text.length,
    truncated,
  };
}

/**
 * SHA-256 of the file, used to skip re-parsing an unchanged resume (required by
 * the AI & Calling Cost Model chapter). Web Crypto, so it works on the edge.
 */
export async function hashFile(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
