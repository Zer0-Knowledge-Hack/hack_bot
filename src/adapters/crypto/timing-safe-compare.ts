// READ-001 correction: shared constant-time string comparison, previously
// duplicated as src/index.ts's isValidSecret (Telegram) and
// src/adapters/github/signature.ts's inline compare (GitHub). Length is
// checked BEFORE crypto.subtle.timingSafeEqual — that primitive requires
// equal-length inputs, and skipping the length check would either throw or
// (worse) leak length information through an exception instead of a clean
// `false`.
export function timingSafeCompare(provided: string, expected: string): boolean {
  if (!provided) return false;
  const providedBytes = new TextEncoder().encode(provided);
  const expectedBytes = new TextEncoder().encode(expected);
  if (providedBytes.byteLength !== expectedBytes.byteLength) return false;
  return crypto.subtle.timingSafeEqual(providedBytes, expectedBytes);
}
