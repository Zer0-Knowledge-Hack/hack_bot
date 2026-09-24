import { describe, expect, it, vi } from "vitest";
import { createSafeLogger } from "../../../src/adapters/log/safe-logger";
import type { LogEvent } from "../../../src/domain/ports";

// PII fixtures that MUST never reach a log line, even if accidentally
// attached to a LogEvent-shaped object via an unsafe cast (defense in
// depth — the allowlist copies known fields explicitly, it never spreads
// the caller's object).
const PII_FIXTURES = [
  "alice@example.com",
  "+1-555-0100-secret",
  "github.com/real-secret-handle",
  "super-secret-webhook-token",
];

describe("createSafeLogger", () => {
  it("logs only the allowlisted fields (event, teamId, membershipId, field, outcome, errorCode)", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createSafeLogger();

    logger.log({
      event: "update-profile-field",
      teamId: "team-1",
      membershipId: "membership-1",
      field: "full_name",
      outcome: "ok",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(spy.mock.calls[0]?.[0] as string);
    expect(logged).toEqual({
      event: "update-profile-field",
      teamId: "team-1",
      membershipId: "membership-1",
      field: "full_name",
      outcome: "ok",
    });
    spy.mockRestore();
  });

  it("logs the allowlisted `reason` field alongside errorCode", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createSafeLogger();

    logger.log({
      event: "composition",
      outcome: "error",
      errorCode: "ConfigError",
      reason: "PII_KEYRING secret is not valid JSON",
    });

    expect(JSON.parse(spy.mock.calls[0]?.[0] as string)).toEqual({
      event: "composition",
      outcome: "error",
      errorCode: "ConfigError",
      reason: "PII_KEYRING secret is not valid JSON",
    });
    spy.mockRestore();
  });

  it("never logs PII even if an extra property is attached to the entry via an unsafe cast", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createSafeLogger();

    const tainted = {
      event: "update-profile-field",
      outcome: "error" as const,
      errorCode: "FIELD_UNREADABLE",
      // Not part of LogEvent — simulates an accidental leak attempt.
      value: PII_FIXTURES[0],
      email: PII_FIXTURES[0],
      phone: PII_FIXTURES[1],
      socialLink: PII_FIXTURES[2],
      token: PII_FIXTURES[3],
    } as unknown as LogEvent;

    logger.log(tainted);

    const loggedText = spy.mock.calls[0]?.[0] as string;
    for (const fixture of PII_FIXTURES) {
      expect(loggedText).not.toContain(fixture);
    }
    const logged = JSON.parse(loggedText);
    expect(Object.keys(logged).sort()).toEqual(["errorCode", "event", "outcome"]);
    spy.mockRestore();
  });
});
