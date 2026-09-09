import type { RecordAttemptResult } from "@microsonya/shared";

export class AttemptCommitConflict extends Error {
  constructor(
    readonly result: Exclude<RecordAttemptResult, { status: "committed" }>,
  ) {
    super(`Attempt commit: ${result.status}`);
    this.name = "AttemptCommitConflict";
  }
}
