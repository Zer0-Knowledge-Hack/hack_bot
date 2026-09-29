// Reduces a fetched HTML page into bounded plain text for the LLM
// extractor (design.md "HTMLRewriter drops noise elements and keeps the
// title, the meta and OG description and ld+json (up to 4 KB). The text is
// capped at 22,000 chars."). Everything runs through one HTMLRewriter pass.
// Each selector's handlers see the ORIGINAL parsed document independently
// of other selectors' `element.remove()` calls (those only rewrite the
// output stream, they do not hide content from a differently-scoped
// handler) — so noise elements (script, style, nav, footer, header,
// noscript, iframe, svg, form, aside) are tracked with a shared depth
// counter, and the visible-text collector skips any text seen while that
// counter is above zero. <title>, the meta description, Open Graph meta
// tags and an inline `application/ld+json` script are captured separately.
// HTMLRewriter only executes as the transformed Response's body is read —
// `.text()` below is awaited purely to drive the parse, the real return
// value is assembled from the handlers' side effects, never from that read
// result.

const NOISE_TAGS = [
  "style",
  "nav",
  "footer",
  "header",
  "noscript",
  "iframe",
  "svg",
  "form",
  "aside",
];
const LD_JSON_MAX = 4_000; // design.md: "ld+json (up to 4 KB)"
export const TEXT_MAX = 22_000; // design.md: "capped at 22,000 chars"

// Normalizes page text before it reaches the LLM. Rendered `innerText`
// separates table cells with TAB characters; models copy snippets containing
// raw TABs into JSON string literals, which JSON.parse rejects ("Bad control
// character in string literal"). So every ASCII control character except
// "\n" (TAB, CR, NUL, ...) becomes a space, runs of spaces collapse within a
// line, lines are trimmed, and 3+ consecutive newlines collapse to a single
// blank line. Paragraph breaks ("\n\n") are kept.
export function normalizePageText(text: string): string {
  return text
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ")
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function htmlToText(response: Response): Promise<string> {
  let title = "";
  let metaDescription = "";
  const og: string[] = [];
  let ldJson = "";
  let capturingLdJson = false;
  const body: string[] = [];
  let noiseDepth = 0;

  let rewriter = new HTMLRewriter().on("script", {
    element(el) {
      const type = el.getAttribute("type");
      const isLdJson = type !== null && type.toLowerCase() === "application/ld+json";
      capturingLdJson = isLdJson;
      if (!isLdJson) {
        // A non-ld+json script is noise: remove it, and count it toward
        // the shared depth so the body text collector below skips its
        // (otherwise still-visited) text nodes too.
        noiseDepth += 1;
        el.remove();
      }
      el.onEndTag(() => {
        capturingLdJson = false;
        if (!isLdJson) noiseDepth -= 1;
      });
    },
    text(chunk) {
      if (capturingLdJson && ldJson.length < LD_JSON_MAX) {
        ldJson += chunk.text;
      }
    },
  });

  for (const tag of NOISE_TAGS) {
    rewriter = rewriter.on(tag, {
      element(el) {
        noiseDepth += 1;
        el.remove();
        el.onEndTag(() => {
          noiseDepth -= 1;
        });
      },
    });
  }

  rewriter = rewriter
    .on("title", {
      text(chunk) {
        title += chunk.text;
      },
    })
    .on("meta", {
      element(el) {
        const name = el.getAttribute("name");
        const property = el.getAttribute("property");
        const content = el.getAttribute("content") ?? "";
        if (name && name.toLowerCase() === "description") {
          metaDescription = content;
        }
        if (property && property.toLowerCase().startsWith("og:")) {
          og.push(`${property}: ${content}`);
        }
      },
    })
    .on("body", {
      text(chunk) {
        if (noiseDepth === 0) body.push(chunk.text);
      },
    });

  const transformed = rewriter.transform(response);
  await transformed.text();

  const parts: string[] = [];
  if (title.trim()) parts.push(title.trim());
  if (metaDescription.trim()) parts.push(metaDescription.trim());
  if (og.length > 0) parts.push(og.join("\n"));
  if (ldJson.trim()) parts.push(ldJson.trim().slice(0, LD_JSON_MAX));
  const visibleText = body.join("").replace(/\s+/g, " ").trim();
  if (visibleText) parts.push(visibleText);

  return normalizePageText(parts.join("\n\n")).slice(0, TEXT_MAX);
}
