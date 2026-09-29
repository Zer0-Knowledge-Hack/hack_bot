import { LLM_PARSE_FAILURE_CODES } from "../../domain/errors";
import type { LogEvent, Logger } from "../../domain/ports";

const FINISH_REASON_PATTERN = /^[A-Za-z_-]{1,20}$/;

type Attempt = NonNullable<LogEvent["attempts"]>[number];

// Parse metadata is re-validated here (not trusted from the caller): only a
// short plain-token finish reason, a finite number, a fixed parse-failure
// code and a literal true can pass — never free text from a model.
function safeParseMeta(a: Attempt): Partial<Attempt> {
  return {
    ...(typeof a.finishReason === "string"
      ? { finishReason: FINISH_REASON_PATTERN.test(a.finishReason) ? a.finishReason : "other" }
      : {}),
    ...(typeof a.contentLength === "number" && Number.isFinite(a.contentLength)
      ? { contentLength: a.contentLength }
      : {}),
    ...(a.parseFailure !== undefined && LLM_PARSE_FAILURE_CODES.includes(a.parseFailure)
      ? { parseFailure: a.parseFailure }
      : {}),
    ...(a.recovered === true ? { recovered: true } : {}),
  };
}

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
                // Fixed literal only; anything else is dropped.
                ...(a.shape === "invalid" ? { shape: "invalid" as const } : {}),
                rejectedCount: a.rejectedCount,
                rejected: a.rejected.map((r) => ({ field: r.field, reason: r.reason })),
                ...safeParseMeta(a),
              })),
            }
          : {}),
      };
      console.log(JSON.stringify(safe));
    },
  };
}
