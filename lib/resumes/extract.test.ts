import { describe, expect, it } from "vitest";
import {
  detectFileKind,
  extractResumeText,
  hashFile,
  MIN_USEFUL_CHARACTERS,
  normalizeExtractedText,
} from "./extract";

function bufferFrom(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const realisticResume = `
Rahul Sharma
Senior Software Engineer
Gurgaon, India | rahul@example.com | +91 98765 43210

EXPERIENCE
Infosys — Software Engineer (Jan 2021 - Present)
Built Spring Boot microservices on AWS handling high traffic.

TCS — Junior Developer (2019 - 2021)
Java backend development and REST API design.

SKILLS
Java, Spring Boot, AWS, PostgreSQL, Docker

EDUCATION
B.Tech Computer Science, Delhi Technological University, 2019
`.trim();

describe("detectFileKind", () => {
  it("detects by MIME type", () => {
    expect(detectFileKind("cv", "application/pdf")).toBe("pdf");
    expect(
      detectFileKind(
        "cv",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      )
    ).toBe("docx");
    expect(detectFileKind("cv", "text/plain")).toBe("text");
  });

  it("falls back to the file extension when the MIME type is missing or generic", () => {
    // Browsers routinely send application/octet-stream for a drag-and-dropped file.
    expect(detectFileKind("resume.pdf", null)).toBe("pdf");
    expect(detectFileKind("resume.docx", "application/octet-stream")).toBe("docx");
    expect(detectFileKind("resume.txt", "")).toBe("text");
  });

  it("is case-insensitive about the extension", () => {
    expect(detectFileKind("RESUME.PDF", null)).toBe("pdf");
  });

  it("rejects legacy .doc rather than producing mojibake", () => {
    // mammoth cannot read the old binary format; failing clearly beats garbage.
    expect(detectFileKind("resume.doc", "application/msword")).toBeNull();
  });

  it("rejects anything else", () => {
    expect(detectFileKind("photo.png", "image/png")).toBeNull();
    expect(detectFileKind("archive.zip", "application/zip")).toBeNull();
  });
});

describe("normalizeExtractedText", () => {
  it("keeps line structure, which resumes depend on", () => {
    expect(normalizeExtractedText("Line one\nLine two")).toBe("Line one\nLine two");
  });

  it("collapses the blank-line runs PDFs produce", () => {
    expect(normalizeExtractedText("A\n\n\n\n\nB")).toBe("A\n\nB");
  });

  it("collapses horizontal runs including non-breaking spaces", () => {
    expect(normalizeExtractedText("Java     Spring  Boot")).toBe("Java Spring Boot");
  });

  it("normalises Windows line endings", () => {
    expect(normalizeExtractedText("A\r\nB")).toBe("A\nB");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeExtractedText("\n\n  Hello  \n\n")).toBe("Hello");
  });
});

describe("extractResumeText", () => {
  it("extracts a plain-text resume", async () => {
    const result = await extractResumeText({
      buffer: bufferFrom(realisticResume),
      fileName: "rahul.txt",
      mimeType: "text/plain",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("Spring Boot");
      expect(result.characters).toBeGreaterThan(MIN_USEFUL_CHARACTERS);
      expect(result.truncated).toBe(false);
    }
  });

  it("reports an empty file rather than throwing", async () => {
    const result = await extractResumeText({
      buffer: new ArrayBuffer(0),
      fileName: "empty.pdf",
      mimeType: "application/pdf",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("empty_file");
  });

  it("reports an unsupported type with a message naming what IS supported", async () => {
    const result = await extractResumeText({
      buffer: bufferFrom("not a resume"),
      fileName: "photo.png",
      mimeType: "image/png",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unsupported_type");
      expect(result.message).toMatch(/PDF, DOCX/);
    }
  });

  it("reports a scan-like file as no_text_layer, not as a parse failure", async () => {
    // The failure that matters most: passing near-empty text to the model would
    // make it hallucinate, and the recruiter would blame the AI.
    const result = await extractResumeText({
      buffer: bufferFrom("Rahul"),
      fileName: "scan.txt",
      mimeType: "text/plain",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no_text_layer");
      // Must name a route forward, not just refuse.
      expect(result.message).toMatch(/manually|text-based/i);
    }
  });

  it("returns a corrupt-file result for an unreadable PDF instead of throwing", async () => {
    const result = await extractResumeText({
      buffer: bufferFrom("%PDF-1.4 this is not really a pdf"),
      fileName: "broken.pdf",
      mimeType: "application/pdf",
    });

    // Either outcome is acceptable; what matters is that it did not throw.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["corrupt_file", "no_text_layer"]).toContain(result.reason);
    }
  });

  it("truncates a very long resume and says so", async () => {
    const long = realisticResume + "\n" + "Additional detail. ".repeat(5000);
    const result = await extractResumeText({
      buffer: bufferFrom(long),
      fileName: "long.txt",
      mimeType: "text/plain",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.truncated).toBe(true);
      // characters reports the ORIGINAL length, so the UI can be honest.
      expect(result.characters).toBeGreaterThan(result.text.length);
    }
  });
});

describe("hashFile", () => {
  it("is stable for identical content", async () => {
    const a = await hashFile(bufferFrom(realisticResume));
    const b = await hashFile(bufferFrom(realisticResume));
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("differs for different content", async () => {
    const a = await hashFile(bufferFrom(realisticResume));
    const b = await hashFile(bufferFrom(realisticResume + " "));
    expect(a).not.toBe(b);
  });
});
