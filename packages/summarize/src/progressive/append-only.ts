export class ProgressiveOutputInvariantError extends Error {
  constructor() {
    super("Progressive output must be append-only.");
    this.name = "ProgressiveOutputInvariantError";
  }
}

export function assertAppendOnly(previous: string, next: string): void {
  if (!next.startsWith(previous)) throw new ProgressiveOutputInvariantError();
}
