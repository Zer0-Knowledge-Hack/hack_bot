import { describe, expect, it } from "vitest";
import { matchConfirmLexicon, normalizeLexiconToken } from "../../../src/domain/nl/lexicon";

describe("normalizeLexiconToken", () => {
  it("lowercases, strips diacritics, and drops trailing punctuation", () => {
    expect(normalizeLexiconToken("  Sí! ")).toBe("si");
    expect(normalizeLexiconToken("DE ACUERDO.")).toBe("de acuerdo");
    expect(normalizeLexiconToken("cancelar…")).toBe("cancelar");
  });
});

describe("matchConfirmLexicon", () => {
  it("matches yes tokens including sí → si", () => {
    for (const raw of ["sí", "si", "dale", "confirmo", "ok", "okay", "de acuerdo", "va!", "claro."]) {
      expect(matchConfirmLexicon(raw)).toBe("yes");
    }
  });

  it("matches cancel tokens", () => {
    for (const raw of ["no", "nop", "cancelar", "cancel", "mejor no"]) {
      expect(matchConfirmLexicon(raw)).toBe("cancel");
    }
  });

  it("returns null for non-lexicon text", () => {
    expect(matchConfirmLexicon("tal vez")).toBeNull();
    expect(matchConfirmLexicon("sí dale")).toBeNull();
    expect(matchConfirmLexicon("")).toBeNull();
  });
});
