export class MicrosonyaError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "MicrosonyaError";
  }
}
