import { describe, expect, it } from "vitest";
import { assertSafeUrl, normalizeUrlKey } from "../../../src/domain/hackathon/url";

describe("assertSafeUrl", () => {
  it("refuses a non-http(s) scheme (spec page-fetch: Disallowed scheme)", () => {
    expect(assertSafeUrl("file:///etc/passwd")).toEqual({
      ok: false,
      reason: "scheme",
    });
  });

  it("accepts a plain https URL", () => {
    const result = assertSafeUrl("https://example.com/event");
    expect(result.ok).toBe(true);
  });

  it("refuses userinfo in the URL", () => {
    expect(assertSafeUrl("https://user:pass@example.com/event")).toEqual({
      ok: false,
      reason: "userinfo",
    });
  });

  it("refuses a non-default port", () => {
    expect(assertSafeUrl("https://example.com:8443/event")).toEqual({
      ok: false,
      reason: "port",
    });
  });

  it("refuses a loopback IPv4 literal (spec page-fetch: Loopback or private host)", () => {
    expect(assertSafeUrl("http://127.0.0.1/event")).toEqual({
      ok: false,
      reason: "ip-literal",
    });
  });

  it("refuses an RFC1918 private IPv4 literal (spec page-fetch: Loopback or private host)", () => {
    expect(assertSafeUrl("http://10.0.0.5/event")).toEqual({
      ok: false,
      reason: "ip-literal",
    });
  });

  it("refuses the cloud metadata address (spec page-fetch: Loopback or private host)", () => {
    expect(assertSafeUrl("http://169.254.169.254/latest/meta-data")).toEqual({
      ok: false,
      reason: "ip-literal",
    });
  });

  it("refuses the literal hostname localhost", () => {
    expect(assertSafeUrl("http://localhost/event")).toEqual({
      ok: false,
      reason: "ip-literal",
    });
  });

  it("refuses a single-label host", () => {
    expect(assertSafeUrl("http://intranet/event")).toEqual({
      ok: false,
      reason: "single-label-host",
    });
  });

  it("refuses a private-suffix host", () => {
    expect(assertSafeUrl("http://service.internal/event")).toEqual({
      ok: false,
      reason: "private-suffix",
    });
  });
});

describe("normalizeUrlKey", () => {
  it("lowercases the host, drops www. and defaults to https", () => {
    expect(normalizeUrlKey(new URL("HTTP://WWW.Example.com/Event"))).toBe(
      "https://example.com/Event",
    );
  });

  it("drops the fragment, default port, and a trailing slash", () => {
    expect(normalizeUrlKey(new URL("https://example.com:443/event/#section"))).toBe(
      "https://example.com/event",
    );
  });

  it("drops tracking parameters and sorts the remaining ones", () => {
    expect(
      normalizeUrlKey(
        new URL("https://example.com/event?utm_source=x&b=2&a=1&fbclid=abc"),
      ),
    ).toBe("https://example.com/event?a=1&b=2");
  });
});
