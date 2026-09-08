export interface ProgressiveCadencePolicy {
  readonly firstMaxWaitMs: number;
  readonly firstMinChars: number;
  readonly minIntervalMs: number;
  readonly minDeltaChars: number;
  readonly maxStalenessMs: number;
}

export const PRIVATE_PROGRESSIVE_POLICY: ProgressiveCadencePolicy = {
  firstMaxWaitMs: 300,
  firstMinChars: 20,
  minIntervalMs: 900,
  minDeltaChars: 24,
  maxStalenessMs: 1_800,
};

export const GROUP_PROGRESSIVE_POLICY: ProgressiveCadencePolicy = {
  firstMaxWaitMs: 400,
  firstMinChars: 24,
  minIntervalMs: 1_100,
  minDeltaChars: 32,
  maxStalenessMs: 2_000,
};
