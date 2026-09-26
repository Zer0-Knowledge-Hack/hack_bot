import { describe, expect, it } from "vitest";
import { suggestRepos } from "../../../src/domain/hackathon/suggest";

describe("suggestRepos", () => {
  it("ranks repos by token overlap with the hackathon name, highest first", () => {
    const result = suggestRepos("Meridian Web3 Hackathon", [
      "octocat/meridian-web3-starter",
      "octocat/totally-unrelated",
      "octocat/meridian-docs",
    ]);
    expect(result[0]).toBe("octocat/meridian-web3-starter");
  });

  it("returns at most 3 suggestions, dropping zero-overlap repos", () => {
    const result = suggestRepos("Meridian", [
      "octocat/meridian-a",
      "octocat/meridian-b",
      "octocat/meridian-c",
      "octocat/meridian-d",
      "octocat/unrelated",
    ]);
    expect(result.length).toBeLessThanOrEqual(3);
    expect(result).not.toContain("octocat/unrelated");
  });

  it("returns an empty list when nothing overlaps", () => {
    expect(suggestRepos("Meridian", ["octocat/totally-different"])).toEqual([]);
  });

  it("is deterministic for the same input", () => {
    const repos = ["octocat/meridian-a", "octocat/meridian-tools"];
    expect(suggestRepos("Meridian Tools", repos)).toEqual(
      suggestRepos("Meridian Tools", repos),
    );
  });
});
