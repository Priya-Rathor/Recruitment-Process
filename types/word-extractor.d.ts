// =============================================================================
// Type declarations for `word-extractor`, which ships none.
//
// Narrow on purpose. This declares only the two methods lib/resumes/extract.ts
// actually calls, so an `any` cannot leak out of the import and quietly disable
// type checking around the extraction branch. The library exposes more
// (getHeaders, getFootnotes, getAnnotations); a resume needs none of it —
// headers on a CV hold page numbers, not experience.
// =============================================================================
declare module "word-extractor" {
  /** The parsed document. Each accessor returns plain text. */
  class Document {
    /** The main document body — the only part resume parsing uses. */
    getBody(): string;
    getFootnotes(): string;
    getHeaders(): string;
  }

  export default class WordExtractor {
    /** Reads a legacy binary .doc (OLE compound document) from a buffer. */
    extract(source: Buffer | string): Promise<Document>;
  }
}
