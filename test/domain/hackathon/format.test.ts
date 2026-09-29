import { describe, expect, it } from "vitest";
import { formatAnalysis, formatHackathonsList } from "../../../src/domain/hackathon/format";
import type { ExtractedFields } from "../../../src/domain/hackathon/extraction";

function emptyFields(): ExtractedFields {
  return {
    name: null,
    format: null,
    location: null,
    teamSize: null,
    submissionDeadline: null,
    startDate: null,
    endDate: null,
    resultsDate: null,
    prizes: null,
    tracks: null,
    eligibility: null,
  };
}

describe("formatAnalysis", () => {
  it("includes the slug and every non-null field's value", () => {
    const text = formatAnalysis({
      slug: "meridian",
      fields: {
        ...emptyFields(),
        name: { value: "Meridian 2026", snippet: "Meridian 2026", confidence: 0.9 },
        submissionDeadline: {
          value: "2026-03-01",
          snippet: "deadline 2026-03-01",
          confidence: 0.8,
        },
      },
      suggestions: [],
    });
    expect(text).toContain("meridian");
    expect(text).toContain("Meridian 2026");
    expect(text).toContain("2026-03-01");
  });

  it("labels every field in Spanish, keeping order and page values verbatim", () => {
    const field = (value: string) => ({ value, snippet: value, confidence: 0.9 });
    const text = formatAnalysis({
      slug: "meridian",
      fields: {
        name: field("Meridian 2026"),
        format: field("Online"),
        location: field("Lima"),
        teamSize: { value: 4, snippet: "4", confidence: 0.9 },
        submissionDeadline: field("2026-03-01"),
        startDate: field("2026-02-01"),
        endDate: field("2026-02-28"),
        resultsDate: field("2026-03-15"),
        prizes: field("USD 1000"),
        tracks: field("AI"),
        eligibility: field("Open"),
      },
      suggestions: ["octocat/meridian-starter", "acme/kit"],
    });
    expect(text).toBe(
      [
        "Slug: meridian",
        "Nombre: Meridian 2026",
        "Formato: Online",
        "Ubicación: Lima",
        "Tamaño del equipo: 4",
        "Fecha límite de entrega: 2026-03-01",
        "Fecha de inicio: 2026-02-01",
        "Fecha de fin: 2026-02-28",
        "Fecha de resultados: 2026-03-15",
        "Premios: USD 1000",
        "Categorías: AI",
        "Requisitos: Open",
        "Repositorios sugeridos: octocat/meridian-starter, acme/kit",
      ].join("\n"),
    );
  });

  it("omits a null field from the reply", () => {
    const text = formatAnalysis({ slug: "meridian", fields: emptyFields(), suggestions: [] });
    expect(text).not.toContain("null");
    expect(text).not.toContain("undefined");
  });

  it("lists suggested repos when present", () => {
    const text = formatAnalysis({
      slug: "meridian",
      fields: emptyFields(),
      suggestions: ["octocat/meridian-starter"],
    });
    expect(text).toContain("octocat/meridian-starter");
  });

  it("stays at or below 4096 characters", () => {
    const text = formatAnalysis({
      slug: "meridian",
      fields: {
        ...emptyFields(),
        name: { value: "x".repeat(5000), snippet: "x".repeat(160), confidence: 0.9 },
      },
      suggestions: [],
    });
    expect(text.length).toBeLessThanOrEqual(4096);
  });
});

describe("formatHackathonsList", () => {
  it("lists slug, name, deadline, and linked status (spec: Listing within the limit)", () => {
    const text = formatHackathonsList([
      { slug: "meridian", name: "Meridian 2026", deadline: "2026-03-01", linked: true },
      { slug: "orbit", name: null, deadline: null, linked: false },
    ]);
    expect(text).toContain("meridian");
    expect(text).toContain("Meridian 2026");
    expect(text).toContain("2026-03-01");
    expect(text).toContain("orbit");
  });

  it("renders Spanish markers for linked, unlinked and missing values", () => {
    const text = formatHackathonsList([
      { slug: "meridian", name: "Meridian 2026", deadline: "2026-03-01", linked: true },
      { slug: "orbit", name: null, deadline: null, linked: false },
    ]);
    expect(text).toBe(
      [
        "meridian — Meridian 2026 — 2026-03-01 — vinculado",
        "orbit — (sin nombre) — sin fecha límite — no vinculado",
      ].join("\n"),
    );
  });

  it("truncates and appends a '…y N más' note past 4096 characters (spec: Listing exceeds the limit)", () => {
    const entries = Array.from({ length: 200 }, (_, i) => ({
      slug: `hackathon-${i}`,
      name: `Hackathon Number ${i}`.repeat(3),
      deadline: "2026-03-01",
      linked: false,
    }));
    const text = formatHackathonsList(entries);
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text).toMatch(/…y \d+ más$/);
  });

  it("returns a fixed message when there are no analyses", () => {
    expect(formatHackathonsList([])).toBe("Todavía no se ha analizado ningún hackathon.");
  });
});
