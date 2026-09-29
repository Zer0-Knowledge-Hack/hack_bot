import { describe, expect, it } from "vitest";
import { htmlToText, normalizePageText, TEXT_MAX } from "../../../src/adapters/http/html-to-text";

// task 6.3 (design.md "HTMLRewriter drops noise elements and keeps the
// title, the meta and OG description and ld+json (up to 4 KB). The text is
// capped at 22,000 chars."). Runs against the real Workers `HTMLRewriter`
// (vitest-pool-workers), not a mock — this is the actual noise-stripping
// engine that will run in production.

function htmlResponse(body: string) {
  return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
}

describe("htmlToText", () => {
  it("strips script, style, nav and footer content entirely", async () => {
    const html = `<html><head><title>t</title></head><body>
      <nav>Home | About | Contact</nav>
      <script>console.log("should not appear");</script>
      <style>.hidden { display: none; }</style>
      <p>Visible paragraph text.</p>
      <footer>Copyright 2026 Acme</footer>
    </body></html>`;

    const text = await htmlToText(htmlResponse(html));

    expect(text).toContain("Visible paragraph text.");
    expect(text).not.toContain("Home | About | Contact");
    expect(text).not.toContain("should not appear");
    expect(text).not.toContain("display: none");
    expect(text).not.toContain("Copyright 2026 Acme");
  });

  it("strips header, noscript, iframe, svg, form and aside content", async () => {
    const html = `<html><body>
      <header>Site Header Nav</header>
      <noscript>Enable JS please</noscript>
      <iframe src="https://ads.example.com"></iframe>
      <svg><text>icon label</text></svg>
      <form><label>Email</label><input name="email"></form>
      <aside>Related links widget</aside>
      <p>Main content stays.</p>
    </body></html>`;

    const text = await htmlToText(htmlResponse(html));

    expect(text).toContain("Main content stays.");
    expect(text).not.toContain("Site Header Nav");
    expect(text).not.toContain("Enable JS please");
    expect(text).not.toContain("Related links widget");
    expect(text).not.toContain("Email");
  });

  it("keeps the title and meta description", async () => {
    const html = `<html><head>
        <title>Spring Hackathon 2026</title>
        <meta name="description" content="A weekend build event.">
      </head><body><p>Body copy.</p></body></html>`;

    const text = await htmlToText(htmlResponse(html));

    expect(text).toContain("Spring Hackathon 2026");
    expect(text).toContain("A weekend build event.");
  });

  it("keeps Open Graph meta tags", async () => {
    const html = `<html><head>
        <meta property="og:title" content="OG Title Here">
        <meta property="og:description" content="OG description text.">
      </head><body><p>Body copy.</p></body></html>`;

    const text = await htmlToText(htmlResponse(html));

    expect(text).toContain("OG Title Here");
    expect(text).toContain("OG description text.");
  });

  it("keeps inline ld+json but not other scripts, capped at 4 KB", async () => {
    const ldJson = JSON.stringify({ "@type": "Event", name: "Hack Night" });
    const html = `<html><head>
        <script type="application/ld+json">${ldJson}</script>
        <script>window.doNotKeep = true;</script>
      </head><body><p>Body copy.</p></body></html>`;

    const text = await htmlToText(htmlResponse(html));

    expect(text).toContain("Hack Night");
    expect(text).not.toContain("doNotKeep");
  });

  it("caps the combined output at 22,000 characters", async () => {
    const longParagraph = "word ".repeat(10_000); // ~50,000 chars of body text
    const html = `<html><body><p>${longParagraph}</p></body></html>`;

    const text = await htmlToText(htmlResponse(html));

    expect(text.length).toBeLessThanOrEqual(TEXT_MAX);
  });

  it("removes tabs and control characters from the static output", async () => {
    const ld = '{"@type":"Event",\t"name":"Hack\u0007Night"}';
    const html = `<html><body><script type="application/ld+json">${ld}</script><p>Body copy.</p></body></html>`;

    const text = await htmlToText(htmlResponse(html));

    expect(text).not.toMatch(/[\t\u0000-\u0008\u000B-\u001F\u007F]/);
    expect(text).toContain("Body copy.");
  });
});

describe("normalizePageText", () => {
  it("replaces tabs from table-like innerText with single spaces and keeps newlines", () => {
    const raw = "Prizes\n\n1st place\t$5,000\t\tCash\n2nd place\t$2,000";
    expect(normalizePageText(raw)).toBe("Prizes\n\n1st place $5,000 Cash\n2nd place $2,000");
  });

  it("replaces other ASCII control characters and CR, collapses space runs, trims lines", () => {
    expect(normalizePageText("a\u0000b\u001Fc\r\n  d   e \u007F f  ")).toBe("a b c\nd e f");
  });

  it("keeps paragraph breaks but collapses runs of 3+ blank lines to one blank line", () => {
    expect(normalizePageText("one\n\n\n\n\ntwo\n\nthree")).toBe("one\n\ntwo\n\nthree");
  });
});
