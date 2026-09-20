// =============================================================================
// The Scoreboad logo.
//
// ONE COMPONENT, THREE LOCKUPS, chosen by how much room the context has. The
// alternative — every page reaching for an <Image> with its own dimensions —
// is how a logo ends up eight different sizes across a product.
//
//   full     mark + wordmark + "Smarter Hiring. Brighter Teams."   2.72 : 1
//   compact  mark + wordmark, tagline dropped                      4.16 : 1
//   mark     the swirl alone, square                               1 : 1
//
// WHY THE TAGLINE IS DROPPED IN THE NAV. The source lockup is 2.72:1 including
// the tagline. In a 60px bar the logo is about 30px tall, which renders the
// strapline at roughly 5px — not small, unreadable. A strapline nobody can read
// is noise wearing the brand's clothes, so the nav gets the compact lockup and
// the auth pages, which have room for a taller logo, get the full one.
//
// THESE ASSETS ARE DRAWN FOR A DARK GROUND, which is new. The retired lockup
// was painted for light surfaces, and the marketing site therefore had a
// component of its own that set the name as TEXT beside the monogram on a white
// plate, because the old asset's dark half vanished on a dark band. The swirl is
// light-on-transparent with its own soft glow, so it needs neither: that
// component and its plate are deleted, and the marketing header and footer now
// render these assets like everywhere else.
//
// The compact lockup IS a horizontal crop of the source, which the retired one
// could not be: the swirl sits left of the wordmark rather than overlapping the
// tagline band, so the tagline cuts away cleanly above y=465 of the source.
// =============================================================================
import Image from "next/image";

/** Intrinsic sizes of the generated assets, used to keep the aspect exact. */
const ASSETS = {
  full: { src: "/brand/logo.png", width: 489, height: 180 },
  compact: { src: "/brand/logo-compact.png", width: 499, height: 120 },
  mark: { src: "/brand/mark.png", width: 256, height: 256 },
} as const;

export type LogoVariant = keyof typeof ASSETS;

export function Logo({
  variant = "compact",
  height = 32,
  priority = false,
  className,
}: {
  variant?: LogoVariant;
  /** Rendered height in px. Width follows from the asset's aspect ratio. */
  height?: number;
  /**
   * Set on the logo that is part of the first paint (the nav, the auth card).
   * Without it Next lazy-loads the image and the brand pops in a beat late.
   */
  priority?: boolean;
  className?: string;
}) {
  const asset = ASSETS[variant];
  const width = Math.round((asset.width / asset.height) * height);

  return (
    <Image
      src={asset.src}
      // The logo is the company's name rendered as a picture, so the alt text
      // is that name — not "logo", which describes the file rather than the
      // content, and reads as "Scoreboad logo logo" beside a heading.
      alt="Scoreboad"
      width={width}
      height={height}
      priority={priority}
      className={className}
      style={{ height, width: "auto" }}
    />
  );
}
