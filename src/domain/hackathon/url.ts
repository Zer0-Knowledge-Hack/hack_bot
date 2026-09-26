// SSRF guard and normalization for the hackathon page URL (spec page-fetch:
// "Scheme and Destination Guard on the Static Path", design.md "Parsing,
// Normalization, Slugs"). Pure string/URL parsing only — no DNS lookup is
// possible here, so this catches literal IPs and known-unsafe hostnames.
// The adapter re-applies this same guard on every redirect and browser
// sub-request (design.md); DNS rebinding is a documented residual risk
// (design.md "Threat Matrix").

export type UnsafeUrlReason =
  | "scheme"
  | "userinfo"
  | "port"
  | "ip-literal"
  | "single-label-host"
  | "private-suffix";

export type SafeUrlResult =
  | { ok: true; url: URL }
  | { ok: false; reason: UnsafeUrlReason };

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);
const ALLOWED_PORTS = new Set(["", "80", "443"]);

// Hostnames widely used for internal/private networks that would otherwise
// slip through the IP-literal check (design.md "single-label and private
// suffixes").
const PRIVATE_SUFFIXES = [".local", ".internal", ".lan", ".home", ".corp"];

export function assertSafeUrl(raw: string): SafeUrlResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "scheme" };
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return { ok: false, reason: "scheme" };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "userinfo" };
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    return { ok: false, reason: "port" };
  }

  // Trailing dots (e.g. "localhost.", "foo.internal..") must not bypass any
  // host check below (RISK-002). The URL parser keeps every one of them, so
  // strip them all; a host made only of dots becomes empty and is refused as
  // single-label.
  const hostname = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (hostname === "localhost" || isUnsafeIpLiteral(hostname)) {
    return { ok: false, reason: "ip-literal" };
  }
  if (!hostname.includes(".")) {
    return { ok: false, reason: "single-label-host" };
  }
  if (PRIVATE_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return { ok: false, reason: "private-suffix" };
  }

  return { ok: true, url };
}

function isUnsafeIpLiteral(hostname: string): boolean {
  return isUnsafeIpv4(hostname) || isUnsafeIpv6(hostname);
}

function isUnsafeIpv4(hostname: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return false;
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((n) => n > 255)) return false;
  const [a = 0, b = 0] = octets;
  if (a === 0) return true; // 0.0.0.0/8, "this network" / unspecified address
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local + metadata address
  return false;
}

function isUnsafeIpv6(hostname: string): boolean {
  const literal = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (!literal.includes(":")) return false;
  if (literal === "::1") return true; // loopback
  const lower = literal.toLowerCase();
  if (lower.startsWith("fe80:")) return true; // link-local
  if (/^fc[0-9a-f]{2}:/.test(lower) || /^fd[0-9a-f]{2}:/.test(lower)) return true; // ULA
  return false;
}

// Tracking parameters stripped before comparing two URLs for "same event
// page" purposes (design.md "Normalization key").
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "msclkid",
  "ref",
]);

// Design.md "Normalization key": lowercase host without `www.`, no fragment
// or default port, tracking parameters dropped and the rest sorted, no
// trailing `/`, and scheme `https`. Two URLs that normalize to the same key
// are treated as the same event page (spec: "Same-URL Refresh Keeps the
// Slug").
export function normalizeUrlKey(url: URL): string {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  const params = new URLSearchParams(url.search);
  const kept: Array<[string, string]> = [];
  for (const [key, value] of params) {
    const lowerKey = key.toLowerCase();
    if (!TRACKING_PARAMS.has(lowerKey) && !lowerKey.startsWith("utm_")) {
      kept.push([key, value]);
    }
  }
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = kept.length > 0
    ? `?${kept.map(([k, v]) => `${k}=${v}`).join("&")}`
    : "";

  const path = url.pathname.replace(/\/+$/, "");

  return `https://${host}${path}${query}`;
}
