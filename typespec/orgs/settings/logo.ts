export const logoContentTypeValues = ["image/jpeg", "image/png"] as const;

export type LogoContentType = (typeof logoContentTypeValues)[number];

/** Bounds the request body and the re-encoded image. */
export const maxLogoBytes = 2 * 1024 * 1024;

/** A logo's sides are each between these bounds, inclusive. */
export const minLogoDimension = 128;
export const maxLogoDimension = 4096;

export function isLogoContentType(value: unknown): value is LogoContentType {
  return (
    typeof value === "string" &&
    (logoContentTypeValues as readonly string[]).includes(value)
  );
}
