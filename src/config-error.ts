// A missing or malformed Worker binding (secret or var). Its `message` is
// logged verbatim as the composition failure `reason` (src/index.ts), so it
// MUST be a fixed, non-sensitive description — never interpolate secret
// values, key material, tokens, or any part of the raw binding.
export class ConfigError extends Error {
  override name = "ConfigError";
}
