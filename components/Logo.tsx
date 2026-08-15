// =============================================================================
// The MyRecruiter Partner logo.
//
// ONE COMPONENT, THREE LOCKUPS, chosen by how much room the context has. The
// alternative — every page reaching for an <Image> with its own dimensions —
// is how a logo ends up eight different sizes across a product.
//
//   full     mark + wordmark + "YOUR AI HIRING MANAGER"   4.09 : 1
//   compact  mark + wordmark, tagline dropped             4.22 : 1
//   mark     the MR monogram alone, square                1 : 1
//
// WHY THE TAGLINE IS DROPPED IN THE NAV. The source lockup is 4.09:1 including
// the tagline. In a 64px bar the logo can be about 32px tall, which renders
// "YOUR AI HIRING MANAGER" at roughly 4px — not small, unreadable. A strapline
// nobody can read is noise wearing the brand's clothes, so the nav gets the
// compact lockup and the auth pages, which have room for a 56px logo, get the
// full one.
//
// The compact lockup is COMPOSED rather than cropped (see the note in the asset
// build): the monogram extends below the wordmark's baseline and the tagline
// overlaps that same band, so no horizontal cut can drop the tagline without
// slicing the handshake off the mark.
// =============================================================================
import Image from "next/image";

/** Intrinsic sizes of the generated assets, used to keep the aspect exact. */
const ASSETS = {
  full: { src: "/brand/logo.png", width: 736, height: 180 },
  compact: { src: "/brand/logo-compact.png", width: 507, height: 120 },
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
      // content, and reads as "MyRecruiter Partner logo logo" beside a heading.
      alt="MyRecruiter Partner"
      width={width}
      height={height}
      priority={priority}
      className={className}
      style={{ height, width: "auto" }}
    />
  );
}
