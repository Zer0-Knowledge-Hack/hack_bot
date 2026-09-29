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
  it("sets the Workers Free plan models GLM-4.7-Flash (primary) and Qwen3-30B-A3B (fallback)", () => {
    expect(wrangler.vars.HACKATHON_MODEL_PRIMARY).toBe("@cf/zai-org/glm-4.7-flash");
    expect(wrangler.vars.HACKATHON_MODEL_FALLBACK).toBe("@cf/qwen/qwen3-30b-a3b-fp8");
  });

  it("uses two different models that pass the adapter's id pattern", () => {
    const pattern = /^@(cf|hf)\/[A-Za-z0-9._/-]+$/;
    const { HACKATHON_MODEL_PRIMARY: p, HACKATHON_MODEL_FALLBACK: f } = wrangler.vars;
    expect(p).toMatch(pattern);
    expect(f).toMatch(pattern);
    expect(p).not.toBe(f);
  });
});
