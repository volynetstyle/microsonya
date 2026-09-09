export type ProgressiveState =
  | "idle"
  | "preparing"
  | "streaming"
  | "finalizing"
  | "completed"
  | "failed";
