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

// Bindings and vars the hackathon queue consumer needs (design.md "File
// Changes": `AI`, `BROWSER`, model vars). Declared here as their own type
// so the consumer composition is typed today; PR10 (task 10.4) folds these
// into `Env` together with the `wrangler.jsonc` bindings.
export interface HackathonConsumerEnv extends Env {
  AI: {
    run(
      model: string,
      inputs: Record<string, unknown>,
      options?: { signal?: AbortSignal },
    ): Promise<unknown>;
  };
  BROWSER: unknown;
  HACKATHON_MODEL_PRIMARY: string;
  HACKATHON_MODEL_FALLBACK: string;
}
