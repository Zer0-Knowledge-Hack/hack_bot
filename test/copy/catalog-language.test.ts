import { describe, expect, it } from "vitest";
import {
  analysisCopy,
  FETCH_FAILURE_PHRASES,
  FIELD_LABELS,
  GITHUB_ALERT_HEADERS,
  githubCopy,
  moreItems,
} from "../../src/domain/copy";
import {
  commonCopy,
  dataChannelCopy,
  hackathonCopy,
  joinCopy,
  pickerCopy,
  profileCopy,
  repoCopy,
  ROLE_LABELS,
  roleCopy,
  setupCopy,
  teamResolutionCopy,
} from "../../src/adapters/telegram/copy";

// Guard for the Spanish-copy change: every bot-authored string reachable from
// the catalogs must be Spanish (no English words from the denylist) and every
// code map must be complete. Scope: the domain catalog and the full Telegram
// adapter catalog plus the GitHub alert headers.
const ENGLISH_DENYLIST =
  /\b(the|you|your|only|could|please|run|usage|team|member|topic|linked|analysis|page|try)\b/i;

type Catalog = { [key: string]: unknown };

// Collects every string leaf; functions are called with sample arguments.
function collectStrings(node: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof node === "string") {
    out.push([path, node]);
    return;
  }
  if (typeof node === "function") {
    out.push([path, String((node as (...args: string[]) => unknown)("sample", "sample", "sample"))]);
    return;
  }
  if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Catalog)) {
      collectStrings(value, `${path}.${key}`, out);
    }
  }
}

function strings(catalog: Catalog, name: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  collectStrings(catalog, name, out);
  return out;
}

const CATALOGS: Array<[string, Catalog]> = [
  ["analysisCopy", analysisCopy as unknown as Catalog],
  ["FIELD_LABELS", FIELD_LABELS as unknown as Catalog],
  ["FETCH_FAILURE_PHRASES", FETCH_FAILURE_PHRASES as unknown as Catalog],
  ["commonCopy", commonCopy as unknown as Catalog],
  ["hackathonCopy", hackathonCopy as unknown as Catalog],
  ["teamResolutionCopy", teamResolutionCopy as unknown as Catalog],
  ["setupCopy", setupCopy as unknown as Catalog],
  ["joinCopy", joinCopy as unknown as Catalog],
  ["dataChannelCopy", dataChannelCopy as unknown as Catalog],
  ["profileCopy", profileCopy as unknown as Catalog],
  ["roleCopy", roleCopy as unknown as Catalog],
  ["repoCopy", repoCopy as unknown as Catalog],
  ["pickerCopy", pickerCopy as unknown as Catalog],
  ["ROLE_LABELS", ROLE_LABELS as unknown as Catalog],
  ["GITHUB_ALERT_HEADERS", GITHUB_ALERT_HEADERS as unknown as Catalog],
  ["githubCopy", githubCopy as unknown as Catalog],
];

describe("copy catalogs are Spanish", () => {
  for (const [name, catalog] of CATALOGS) {
    const entries = strings(catalog, name);

    it(`${name} has non-empty entries`, () => {
      expect(entries.length).toBeGreaterThan(0);
      for (const [path, text] of entries) {
        expect(text.trim(), path).not.toBe("");
      }
    });

    it(`${name} contains no English denylist word`, () => {
      for (const [path, text] of entries) {
        expect(ENGLISH_DENYLIST.test(text), `${path}: ${text}`).toBe(false);
      }
    });
  }

  it("moreItems renders the Spanish truncation summary", () => {
    expect(moreItems(7)).toBe("…y 7 más");
    expect(ENGLISH_DENYLIST.test(moreItems(3))).toBe(false);
  });

  it("the fetch failure map covers every failure kind with a distinct phrase", () => {
    expect(Object.keys(FETCH_FAILURE_PHRASES).sort()).toEqual(
      ["content-type", "http-status", "network", "redirects", "timeout", "too-large"],
    );
    expect(new Set(Object.values(FETCH_FAILURE_PHRASES)).size).toBe(6);
  });

  it("the field label map keeps the reply line order", () => {
    expect(Object.keys(FIELD_LABELS)).toEqual([
      "name",
      "format",
      "location",
      "teamSize",
      "submissionDeadline",
      "startDate",
      "endDate",
      "resultsDate",
      "prizes",
      "tracks",
      "eligibility",
    ]);
  });

  it("the role map covers every role with a distinct Spanish label", () => {
    expect(ROLE_LABELS).toEqual({ admin: "administrador", member: "miembro" });
  });

  it("the link/unlink maps cover both actions with distinct phrases", () => {
    expect(Object.keys(repoCopy.topicRequired).sort()).toEqual(["link", "unlink"]);
    expect(new Set(Object.values(repoCopy.topicRequired)).size).toBe(2);
    expect(repoCopy.usage("linkrepo")).toBe("Uso: /linkrepo <owner/repo o URL del repositorio de GitHub>");
  });

  it("the shared no-team and membership-check phrases are Spanish", () => {
    expect(commonCopy.noTeamForChat).toBe(
      "No hay ningún equipo registrado en este chat. Pide a un administrador que ejecute /setup.",
    );
    expect(commonCopy.membershipCheckFailed("datachannel")).toBe(
      "No se pudo verificar tu pertenencia al equipo. Vuelve a intentar /datachannel.",
    );
  });

  it("the GitHub header map covers all 8 kind:action keys with Spanish text", () => {
    expect(Object.keys(GITHUB_ALERT_HEADERS).sort()).toEqual([
      "issues:closed",
      "issues:merged",
      "issues:opened",
      "issues:review_requested",
      "pull_request:closed",
      "pull_request:merged",
      "pull_request:opened",
      "pull_request:review_requested",
    ]);
    for (const [key, text] of Object.entries(GITHUB_ALERT_HEADERS)) {
      expect(text.trim(), key).not.toBe("");
    }
    expect(githubCopy).toEqual({ reviewerLabel: "Revisor:", byLabel: "Por:" });
  });
});
