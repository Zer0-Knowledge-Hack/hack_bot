import puppeteer from "@cloudflare/puppeteer";
import { BrowserQuotaExceededError } from "../../domain/errors";
import type { Browser, BrowserLaunch } from "./rendered-fetcher";

// The production `launch` injected into `createRenderedFetcher` (design.md
// "File Changes": "Puppeteer with an injected `launch`"). It is a thin
// pass-through to `@cloudflare/puppeteer`, whose `Browser` is structurally
// what the fetcher's minimal `Browser` type was modeled on.
//
// Browser Run reports the daily free-plan limit ("Unable to create new
// browser: code: 429: message: Browser time limit exceeded for today") and
// its rate limit ("429 Too many requests") by rejecting `launch` itself —
// there is no page or navigation status yet — so this is where a 429 becomes
// `BrowserQuotaExceededError` (design.md "A 429 raises
// BrowserQuotaExceededError"; page-fetch spec "Browser Rendering Quota
// Exhaustion"). Any other launch failure propagates unchanged.
export const launchPuppeteerBrowser: BrowserLaunch = async (binding) => {
  try {
    return (await puppeteer.launch(binding as Parameters<typeof puppeteer.launch>[0])) as unknown as Browser;
  } catch (err) {
    if (err instanceof Error && /\b429\b/.test(err.message)) {
      throw new BrowserQuotaExceededError("browser rendering quota exceeded");
    }
    throw err;
  }
};
