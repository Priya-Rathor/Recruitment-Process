import { Logo } from "@/components/Logo";

/**
 * The brand lockup, set as TEXT beside the mark.
 *
 * WHY THIS STILL EXISTS NOW THAT THE ASSETS ARE DRAWN FOR DARK.
 *
 * The original reason is gone: the retired lockup was a raster painted for a
 * light ground, so on the marketing site's dark band its dark half dropped to
 * roughly 1:1 and "Recruiter Partner" simply vanished. The Scoreboad lockup is
 * light-on-transparent with its own glow and has no such problem — the white
 * plate this component used to sit the monogram on is REMOVED.
 *
 * It stays because the reasons that were secondary are now the whole case, and
 * they are better reasons than the bug was:
 *
 *   - the name is selectable, searchable text rather than pixels;
 *   - it scales without resampling, which matters at the hero's fluid sizes;
 *   - a screen reader gets it as text instead of as alt on an image;
 *   - it costs no image request on the marketing site's first paint;
 *   - and the supplied wordmark raster carries visible edge artefacts that are
 *     obvious at hero size. Set in the display face it is simply clean.
 *
 * The two-tone split matches the supplied lockup: "Score" in the highlight,
 * "boad" in the periwinkle accent.
 *
 * The mark is hidden from assistive tech on purpose. Its alt text is the
 * company's name — correct in the app, where the image IS the name — but here
 * the name sits beside it as real text, so leaving it exposed would announce
 * "Scoreboad Scoreboad".
 */
export function MarketingWordmark({ height = 30 }: { height?: number }) {
  return (
    <span className="mkt-wordmark" style={{ ["--mkt-mark-size" as string]: `${height}px` }}>
      <Logo variant="mark" height={height} priority />
      <span className="mkt-wordmark__text">
        Score<span className="mkt-wordmark__accent">boad</span>
      </span>
    </span>
  );
}
