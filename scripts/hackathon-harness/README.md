# Hackathon analysis harness

A dev-only Worker that runs the REAL `src/` modules (static fetcher, rendered
fetcher, Workers AI extractor, `validateExtraction`) on Cloudflare with real
`AI` and `BROWSER` bindings and Cloudflare egress. Unit tests fake all of
these, so they cannot show what production sees (for example, a static fetch
that gets HTTP 403 from Cloudflare egress, or a model copying raw TABs from
rendered page text). This harness can.

It is never deployed, and it is not part of the main Worker bundle, vitest or
`npm run typecheck` (`tsconfig.json` only includes `src`, `test` and
`vitest.config.ts`).

## Cost

Every request runs `wrangler dev --remote`, so it consumes real Workers AI
neurons (one call per model) and Browser Rendering time, billed to your
Cloudflare account. It needs `wrangler login` (or `CLOUDFLARE_API_TOKEN`; set
`CLOUDFLARE_ACCOUNT_ID` if you have several accounts). No DB, queue or
secrets are used.

## Run

```
npm run harness
# in another terminal:
curl "http://localhost:8799/?url=https://www.bnbchain.org/en/hackathons/tokenized-stocks"
```

Optional: `&models=@cf/model-a,@cf/model-b` overrides the model IDs (the
default is the pair in the root `wrangler.jsonc`).

## Output

JSON with:

- `static` / `rendered`: ok, text length, or the error kind and HTTP status.
- `chosen`: `static` or `rendered`, using the same rule as
  `analyzeHackathon` (rendered when the static fetch is bot-walled or thin).
- `pageText`: length and the first 1500 characters of the chosen text.
- `attempts[]`, one per model: `finish` reason, extractor `meta`
  (`parseFailure`, `recovered`, `contentLength`), the first 2500 characters of
  the model content, the `validateExtraction` result and `usable`.

## When to use it

Any change to the fetch, LLM or validation path MUST be checked with
`npm run harness` against real URLs before merge.
