import { describe, expect, it } from "vitest";
import { classifyHackathonArgument, parseJoinArgument } from "../../../src/domain/hackathon/argument";

describe("classifyHackathonArgument", () => {
  it("classifies a slug-shaped argument as a slug (spec: Slug-shaped argument)", () => {
    expect(classifyHackathonArgument("meridian-2")).toEqual({
      kind: "slug",
      value: "meridian-2",
    });
  });

  it("classifies a URL-shaped argument as a URL (spec: URL-shaped argument)", () => {
    expect(classifyHackathonArgument("https://example.com/event")).toEqual({
      kind: "url",
      value: "https://example.com/event",
    });
  });

  it("treats a slug-looking string containing a dot as a URL", () => {
    expect(classifyHackathonArgument("meridian.2")).toEqual({
      kind: "url",
      value: "meridian.2",
    });
  });

  it("treats a slug-looking string containing a colon as a URL", () => {
    expect(classifyHackathonArgument("meridian:2")).toEqual({
      kind: "url",
      value: "meridian:2",
    });
  });

  it("treats an empty string as a URL, not a slug", () => {
    expect(classifyHackathonArgument("")).toEqual({ kind: "url", value: "" });
  });
});

describe("parseJoinArgument", () => {
  it("parses `join <slug>` into a join with the slug", () => {
    expect(parseJoinArgument("join meridian")).toEqual({ kind: "join", slug: "meridian" });
    expect(parseJoinArgument("join meridian-2")).toEqual({ kind: "join", slug: "meridian-2" });
  });

  it("returns join-usage for a bare join", () => {
    expect(parseJoinArgument("join")).toEqual({ kind: "join-usage" });
  });

  it("returns join-usage for a non-slug target", () => {
    expect(parseJoinArgument("join Not_Slug")).toEqual({ kind: "join-usage" });
    expect(parseJoinArgument("join https://x.com/a")).toEqual({ kind: "join-usage" });
  });

  it("returns join-usage when more than one token follows join", () => {
    expect(parseJoinArgument("join a b")).toEqual({ kind: "join-usage" });
  });

  it("returns null for any other argument so the existing rules apply", () => {
    expect(parseJoinArgument("meridian")).toBeNull();
    expect(parseJoinArgument("https://example.com/event")).toBeNull();
    expect(parseJoinArgument("joined meridian")).toBeNull();
    expect(parseJoinArgument("")).toBeNull();
  });
});
