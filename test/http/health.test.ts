import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /health", () => {
  it("returns 200 with a body confirming the worker is up", async () => {
    const response = await SELF.fetch("https://example.com/health");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ status: "ok" });
  });
});
