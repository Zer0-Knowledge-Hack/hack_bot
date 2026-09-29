import type { AnalysisJobMessage } from "../../domain/entities";
import { asTeamId } from "../../domain/ids";

export type ParsedJobMessage =
  | { kind: "ok"; message: AnalysisJobMessage }
  | { kind: "unsupported-version" }
  | { kind: "malformed" };

// design.md "Threat matrix" (queue handler): the body is shape-validated
// before any use. A message from an unknown version is reported separately
// so a rolling deploy is distinguishable from garbage. Fields are copied
// one by one — never spread from the raw body.
export function parseAnalysisJobMessage(body: unknown): ParsedJobMessage {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { kind: "malformed" };
  }
  const raw = body as Record<string, unknown>;
  if (typeof raw.v === "number" && raw.v !== 1) {
    return { kind: "unsupported-version" };
  }
  if (
    raw.v !== 1 ||
    typeof raw.jobId !== "string" ||
    raw.jobId === "" ||
    typeof raw.teamId !== "string" ||
    raw.teamId === "" ||
    typeof raw.chatId !== "number" ||
    !Number.isFinite(raw.chatId) ||
    (raw.threadId !== null && (typeof raw.threadId !== "number" || !Number.isFinite(raw.threadId))) ||
    typeof raw.fetchUrl !== "string" ||
    raw.fetchUrl === ""
  ) {
    return { kind: "malformed" };
  }
  return {
    kind: "ok",
    message: {
      v: 1,
      jobId: raw.jobId,
      teamId: asTeamId(raw.teamId),
      chatId: raw.chatId,
      threadId: raw.threadId,
      fetchUrl: raw.fetchUrl,
    },
  };
}
