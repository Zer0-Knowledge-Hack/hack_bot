import { describe, expect, it } from "vitest";
import {
  matchHackathons,
  normalizeHackathonQuery,
  type HackathonMatchCandidate,
} from "../../../src/domain/nl/hackathon-match";

const CANDIDATES: HackathonMatchCandidate[] = [
  {
    slug: "bnb-hack-online-edition",
    name: "BNB Hack: Online Edition",
    threadId: null,
  },
  {
    slug: "bnb-hack-tokenized-stocks-edition",
    name: "BNB Hack: Tokenized Stocks Edition",
    threadId: 10,
  },
  {
    slug: "meta-vr-start-developer-competition-2026",
    name: "Meta VR Start Developer Competition 2026",
    threadId: null,
  },
];

describe("normalizeHackathonQuery", () => {
  it("strips accents and punctuation", () => {
    expect(normalizeHackathonQuery("  ¡BNB Chain!  ")).toBe("bnb chain");
  });
});

describe("matchHackathons", () => {
  it("returns both BNB hacks for a shared name fragment", () => {
    const hits = matchHackathons(CANDIDATES, "BNB Chain");
    expect(hits.map((h) => h.slug)).toEqual([
      "bnb-hack-online-edition",
      "bnb-hack-tokenized-stocks-edition",
    ]);
  });

  it("narrows to one when the query is specific", () => {
    const hits = matchHackathons(CANDIDATES, "tokenized stocks");
    expect(hits.map((h) => h.slug)).toEqual(["bnb-hack-tokenized-stocks-edition"]);
  });

  it("matches an exact slug", () => {
    const hits = matchHackathons(CANDIDATES, "meta-vr-start-developer-competition-2026");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.slug).toBe("meta-vr-start-developer-competition-2026");
  });

  it("returns empty for nonsense", () => {
    expect(matchHackathons(CANDIDATES, "avalanche subnet xyz")).toEqual([]);
  });
});
