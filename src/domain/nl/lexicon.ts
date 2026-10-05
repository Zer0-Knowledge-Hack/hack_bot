// Affirmative / cancel lexicon for NL confirm replies (design.md).

const TRAILING_PUNCT = /[!?.…]+$/u;

function stripDiacritics(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "");
}

export function normalizeLexiconToken(raw: string): string {
  return stripDiacritics(raw.trim().toLowerCase()).replace(TRAILING_PUNCT, "").trim();
}

const YES_TOKENS = new Set([
  "si",
  "dale",
  "confirmo",
  "ok",
  "okay",
  "de acuerdo",
  "va",
  "claro",
]);

const CANCEL_TOKENS = new Set(["no", "nop", "cancelar", "cancel", "mejor no"]);

export type LexiconMatch = "yes" | "cancel" | null;

export function matchConfirmLexicon(raw: string): LexiconMatch {
  const token = normalizeLexiconToken(raw);
  if (token === "") return null;
  if (YES_TOKENS.has(token)) return "yes";
  if (CANCEL_TOKENS.has(token)) return "cancel";
  return null;
}
