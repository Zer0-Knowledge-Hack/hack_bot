// Production-faithful harness for the hackathon analysis path. Run it with
// `npm run harness` (wrangler dev --remote): it executes the REAL src modules
// on Cloudflare, with real Workers AI and Browser Rendering bindings and
// Cloudflare egress, and reports every intermediate artifact. Never deployed
// and never part of the main Worker bundle, vitest or `npm run typecheck`.
import { launchPuppeteerBrowser } from "../../src/adapters/browser/puppeteer-launch";
import { createRenderedFetcher } from "../../src/adapters/browser/rendered-fetcher";
import { createStaticFetcher } from "../../src/adapters/http/safe-fetcher";
import { createWorkersAiExtractor } from "../../src/adapters/llm/workers-ai-extractor";
import { validateExtraction } from "../../src/domain/hackathon/extraction";
import { isUsable, THIN_STATIC_TEXT_THRESHOLD } from "../../src/domain/usecases/analyze-hackathon";

interface Env {
  AI: { run: (model: string, inputs: unknown, options?: unknown) => Promise<unknown> };
  BROWSER: unknown;
}

// Keep in sync with HACKATHON_MODEL_PRIMARY / HACKATHON_MODEL_FALLBACK in the
// root wrangler.jsonc (a JSONC file with comments cannot be imported here).
// `?models=a,b` overrides them for one request.
const DEFAULT_MODELS = ["@cf/zai-org/glm-4.7-flash", "@cf/qwen/qwen3-30b-a3b-fp8"];

const PAGE_HEAD_CHARS = 1500;
const CONTENT_HEAD_CHARS = 2500;

function describeError(err: unknown) {
  if (err instanceof Error) {
    const e = err as Error & { kind?: string; status?: number; reason?: string };
    return { name: e.name, message: e.message.slice(0, 200), kind: e.kind, status: e.status, reason: e.reason };
  }
  return { value: String(err) };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const target = params.get("url");
    if (!target) return new Response("?url= required", { status: 400 });
    const models = params.get("models")?.split(",").filter(Boolean) ?? DEFAULT_MODELS;
    const report: Record<string, unknown> = { url: target };

    // 1. Static fetch, exactly as production.
    let staticText = "";
    let staticOk = false;
    try {
      staticText = await createStaticFetcher({ fetch: (i, init) => fetch(i, init) }).fetch(
        target,
        AbortSignal.timeout(15_000),
      );
      staticOk = true;
      report.static = { ok: true, length: staticText.length };
    } catch (err) {
      report.static = { ok: false, error: describeError(err) };
    }

    // 2. Rendered fetch, always, so both texts can be compared.
    let renderedText = "";
    try {
      renderedText = await createRenderedFetcher({
        launch: launchPuppeteerBrowser,
        binding: env.BROWSER,
      }).fetch(target, AbortSignal.timeout(40_000));
      report.rendered = { ok: true, length: renderedText.length };
    } catch (err) {
      report.rendered = { ok: false, error: describeError(err) };
    }

    // 3. Same selection rule as analyze-hackathon's resolvePageText: the
    // rendered text is used when the static fetch failed (bot wall) or its
    // text is thin.
    const useRendered = !staticOk || staticText.length < THIN_STATIC_TEXT_THRESHOLD;
    const pageText = useRendered ? renderedText : staticText;
    report.chosen = useRendered ? "rendered" : "static";
    report.pageText = { length: pageText.length, head: pageText.slice(0, PAGE_HEAD_CHARS) };

    // 4. Each model through the REAL extractor, capturing the raw binding result.
    const attempts: unknown[] = [];
    for (const model of models) {
      let rawResult: unknown = null;
      const extractor = createWorkersAiExtractor({
        run: async (m, inputs, options) => {
          rawResult = await env.AI.run(m, inputs, options);
          return rawResult;
        },
      });
      const t0 = Date.now();
      try {
        const out = await extractor.extract(pageText, model, AbortSignal.timeout(90_000));
        const validated = validateExtraction(out.value, pageText);
        const raw = asRecord(rawResult);
        const choice = asRecord((raw?.choices as unknown[] | undefined)?.[0]);
        const message = asRecord(choice?.message);
        const content =
          typeof message?.content === "string"
            ? message.content
            : JSON.stringify(raw?.response ?? message?.content ?? null);
        attempts.push({
          model,
          ms: Date.now() - t0,
          finish: choice?.finish_reason,
          meta: out.meta,
          contentHead: content.slice(0, CONTENT_HEAD_CHARS),
          validate: validated.ok
            ? { ok: true, rejectedCount: validated.rejectedCount, rejections: validated.rejections }
            : validated,
          usable: isUsable(validated),
        });
      } catch (err) {
        attempts.push({ model, ms: Date.now() - t0, threw: describeError(err) });
      }
    }
    report.attempts = attempts;
    return Response.json(report);
  },
};
