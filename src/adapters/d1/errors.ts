import { AlreadyExistsError } from "../../domain/errors";

// D1 surfaces SQLite constraint violations as generic Error messages (e.g.
// "D1_ERROR: UNIQUE constraint failed: teams.telegram_chat_id"). Adapters
// MUST translate these into domain errors rather than leaking raw D1/SQLite
// text to callers (design.md keeps storage-specific failure modes inside
// the adapter layer).
export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

export async function runOrAlreadyExists<T>(
  fn: () => Promise<T>,
  message: string,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AlreadyExistsError(message);
    }
    throw error;
  }
}
