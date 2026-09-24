// Worker bindings/secrets (wrangler.jsonc `d1_databases`, and secrets set via
// `wrangler secret put` / `.dev.vars` locally — see .dev.vars.example).
export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  PII_KEYRING: string;
  BOT_INFO: string;
  // GitHub webhook HMAC secret (design.md "Secret scope" — one global
  // secret). Missing/empty is a config error, never a default (see
  // src/adapters/github/signature.ts).
  GITHUB_WEBHOOK_SECRET: string;
}
