import type { LogEvent, Logger } from "../../domain/ports";

// design.md "Logging": an allowlisted field set only (event, teamId,
// membershipId, field, outcome, errorCode, reason, httpStatus, and the
// name/reason-code-only extraction attempt diagnostics). Update text and values are
// NEVER logged. Fields are copied explicitly, one by one — never spread
// from the caller's object — so an accidental extra property on a
// LogEvent-shaped value (e.g. via an unsafe cast) cannot leak into a log
// line.
export function createSafeLogger(): Logger {
  return {
    log(entry: LogEvent) {
      const safe: LogEvent = {
        event: entry.event,
        outcome: entry.outcome,
        ...(entry.teamId !== undefined ? { teamId: entry.teamId } : {}),
        ...(entry.membershipId !== undefined
          ? { membershipId: entry.membershipId }
          : {}),
        ...(entry.field !== undefined ? { field: entry.field } : {}),
        ...(entry.errorCode !== undefined ? { errorCode: entry.errorCode } : {}),
        ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
        ...(entry.httpStatus !== undefined ? { httpStatus: entry.httpStatus } : {}),
        // Rebuilt key by key so only names and reason codes can reach the log.
        ...(entry.attempts !== undefined
          ? {
              attempts: entry.attempts.map((a) => ({
                model: a.model,
                parsed: a.parsed,
                rejectedCount: a.rejectedCount,
                rejected: a.rejected.map((r) => ({ field: r.field, reason: r.reason })),
              })),
            }
          : {}),
      };
      console.log(JSON.stringify(safe));
    },
  };
}
