import { describe, expect, it } from "vitest";
import wranglerRaw from "../../wrangler.jsonc?raw";

// wrangler.jsonc allows full-line // comments only in this file.
const wrangler = JSON.parse(
  wranglerRaw
    .split("\n")
    .filter((line: string) => !line.trim().startsWith("//"))
    .join("\n"),
) as { vars: Record<string, string> };

// tasks.md 11.4: catalog IDs verified with `wrangler ai models schema`.
// Blank-model behaviour is covered separately through env overrides
// (composition.hackathon-consumer / index.queue tests).
describe("hackathon model vars (11.4)", () => {
  it("sets GLM-5.3-Flash as primary and DeepSeek V4 Flash as fallback", () => {
    expect(wrangler.vars.HACKATHON_MODEL_PRIMARY).toBe("@cf/zai-org/glm-5.3-flash");
    expect(wrangler.vars.HACKATHON_MODEL_FALLBACK).toBe("@cf/deepseek-ai/deepseek-v4-flash-0731");
  });

  it("uses two different models that pass the adapter's id pattern", () => {
    const pattern = /^@(cf|hf)\/[A-Za-z0-9._/-]+$/;
    const { HACKATHON_MODEL_PRIMARY: p, HACKATHON_MODEL_FALLBACK: f } = wrangler.vars;
    expect(p).toMatch(pattern);
    expect(f).toMatch(pattern);
    expect(p).not.toBe(f);
  });
});
