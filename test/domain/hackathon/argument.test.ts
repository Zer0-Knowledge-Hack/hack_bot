import { describe, expect, it } from "vitest";
import { classifyHackathonArgument } from "../../../src/domain/hackathon/argument";

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
