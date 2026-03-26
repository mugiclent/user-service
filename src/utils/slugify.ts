/**
 * Convert a string to a URL-safe slug.
 * e.g. "Volcano Transport Co." → "volcano-transport-co"
 */
export const slugify = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')  // remove non-alphanumeric (except spaces and hyphens)
    .replace(/\s+/g, '-')          // spaces → hyphens
    .replace(/-+/g, '-')           // collapse multiple hyphens
    .replace(/^-|-$/g, '');        // trim leading/trailing hyphens
