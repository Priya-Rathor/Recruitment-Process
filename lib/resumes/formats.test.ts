// =============================================================================
// Resume file formats — tested against REAL files, not mocks.
//
// The three fixtures in __fixtures__/ all carry the same resume text, produced
// from resume-source.txt:
//
//   resume.pdf   Chromium print-to-PDF (a genuine text-layer PDF)
//   resume.docx  macOS textutil       (ZIP of XML — mammoth's format)
//   resume.doc   macOS textutil       (OLE compound document — a DIFFERENT
//                                      binary format that mammoth CANNOT read)
//
// The .doc fixture is the point of this file. .doc and .docx share three
// letters and nothing else, browsers label both "application/msword", and for
// most of this product's life every .doc upload was rejected outright. A mocked
// test would not have caught that; a real OLE file does.
// =============================================================================
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  RESUME_UPLOAD_REJECTION,
  detectFileKind,
  extractResumeText,
  isAllowedResumeUpload,
} from "@/lib/resumes/extract";

const FIXTURES = path.join(process.cwd(), "lib/resumes/__fixtures__");

function load(name: string): ArrayBuffer {
  const buffer = fs.readFileSync(path.join(FIXTURES, name));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

const FORMATS = [
  ["resume.pdf", "application/pdf", "pdf"],
  [
    "resume.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "docx",
  ],
  ["resume.doc", "application/msword", "doc"],
] as const;

describe("extraction across PDF, DOCX and DOC", () => {
  for (const [fileName, mimeType, expectedKind] of FORMATS) {
    it(`reads ${fileName} end to end`, async () => {
      expect(detectFileKind(fileName, mimeType)).toBe(expectedKind);

      const result = await extractResumeText({
        buffer: load(fileName),
        fileName,
        mimeType,
      });

      expect(result.ok, `extraction failed: ${JSON.stringify(result)}`).toBe(true);
      if (!result.ok) return;

      // Every field the parser downstream depends on has to survive the
      // round trip, in all three formats.
      expect(result.text).toContain("Ananya Sharma");
      expect(result.text).toContain("ananya@example.com");
      expect(result.text).toContain("98765 43210");
      expect(result.text).toContain("Gurgaon");
      expect(result.text).toContain("Infosys");
      expect(result.text).toContain("Spring Boot");
      expect(result.text).toContain("18 LPA");
      expect(result.text).toContain("30 days");
    });
  }

  it("recovers comparable text from all three", async () => {
    const lengths = await Promise.all(
      FORMATS.map(async ([fileName, mimeType]) => {
        const result = await extractResumeText({ buffer: load(fileName), fileName, mimeType });
        return result.ok ? result.text.length : 0;
      })
    );

    // Not identical — PDFs add line breaks, Word adds none — but a format that
    // silently dropped half the document would show up here.
    const shortest = Math.min(...lengths);
    const longest = Math.max(...lengths);
    expect(shortest).toBeGreaterThan(600);
    expect(longest / shortest).toBeLessThan(1.4);
  });
});

describe("detectFileKind prefers the extension over the MIME type", () => {
  it("keeps .docx and .doc apart when the browser calls both msword", () => {
    // Chrome sends application/msword for BOTH on some platforms. Trusting it
    // hands a ZIP to the OLE reader, which fails as "corrupt file" on a
    // perfectly good document.
    expect(detectFileKind("cv.docx", "application/msword")).toBe("docx");
    expect(detectFileKind("cv.doc", "application/msword")).toBe("doc");
  });

  it("still classifies a file the browser refused to label", () => {
    expect(detectFileKind("cv.doc", "application/octet-stream")).toBe("doc");
    expect(detectFileKind("cv.pdf", "")).toBe("pdf");
    expect(detectFileKind("cv.docx", null)).toBe("docx");
  });

  it("falls back to the MIME type when there is no useful extension", () => {
    expect(detectFileKind("resume", "application/pdf")).toBe("pdf");
    expect(detectFileKind("resume", "application/msword")).toBe("doc");
  });

  it("returns null for something it cannot read", () => {
    expect(detectFileKind("photo.png", "image/png")).toBeNull();
    expect(detectFileKind("archive.zip", "application/zip")).toBeNull();
  });
});

describe("isAllowedResumeUpload", () => {
  it("accepts PDF and both Word formats", () => {
    expect(isAllowedResumeUpload("cv.pdf", "application/pdf")).toBe(true);
    expect(isAllowedResumeUpload("cv.doc", "application/msword")).toBe(true);
    expect(isAllowedResumeUpload("cv.DOCX", null)).toBe(true);
  });

  it("rejects plain text, which the extractor could otherwise read", () => {
    // Deliberate: extraction supports .txt, resume UPLOAD does not. A recruiter
    // uploading a .txt as a CV is almost always a mistake, and saying so at the
    // picker beats failing four seconds later after an AI call.
    expect(isAllowedResumeUpload("cv.txt", "text/plain")).toBe(false);
  });

  it("rejects images, archives and spreadsheets", () => {
    expect(isAllowedResumeUpload("scan.png", "image/png")).toBe(false);
    expect(isAllowedResumeUpload("cvs.zip", "application/zip")).toBe(false);
    expect(isAllowedResumeUpload("list.csv", "text/csv")).toBe(false);
  });

  it("is not fooled by an extension buried mid-name", () => {
    expect(isAllowedResumeUpload("resume.pdf.exe", "application/octet-stream")).toBe(false);
  });

  it("has one rejection message, matching the spec's wording", () => {
    expect(RESUME_UPLOAD_REJECTION).toBe(
      "Only PDF and Word documents (.doc, .docx) are supported"
    );
  });
});
