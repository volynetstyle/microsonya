import { FREE_SUMMARY_MODELS, type FreeModelProfile } from "./free-models.js";

export type ModelFailure = {
  status?: number;
  body?: unknown;
  retryAfterMs?: number;
};

type ModelState = {
  failures: number;
  cooldownUntil: number;
  lastError?: string;
};

export class FreeModelSwitch {
  private readonly models: FreeModelProfile[];
  private readonly state = new Map<string, ModelState>();
  private cursor = 0;

  constructor(models: FreeModelProfile[] = FREE_SUMMARY_MODELS) {
    this.models = [...models].sort((a, b) => b.priority - a.priority);

    for (const model of this.models) {
      this.state.set(model.id, {
        failures: 0,
        cooldownUntil: 0,
      });
    }
  }

  getRoute(limit = 5): string[] {
    const now = Date.now();
    const available = this.models.filter((model) => {
      const state = this.state.get(model.id);
      return !state || state.cooldownUntil <= now;
    });

    if (available.length === 0) {
      return [];
    }

    const cursor = this.cursor % available.length;
    const rotated = [...available.slice(cursor), ...available.slice(0, cursor)];

    return rotated.slice(0, limit).map((model) => model.id);
  }

  reportSuccess(modelId: string): void {
    const state = this.state.get(modelId);

    if (state) {
      state.failures = 0;
      state.cooldownUntil = 0;
      state.lastError = undefined;
    }

    const index = this.models.findIndex((model) => model.id === modelId);

    if (index >= 0) {
      this.cursor = (index + 1) % this.models.length;
    }
  }

  reportFailure(modelId: string, failure: ModelFailure): void {
    const state =
      this.state.get(modelId) ??
      {
        failures: 0,
        cooldownUntil: 0,
      };

    state.failures += 1;
    state.lastError = JSON.stringify(failure.body ?? failure.status ?? "unknown");
    state.cooldownUntil =
      Date.now() +
      (failure.retryAfterMs ??
        this.defaultCooldownMs(failure.status, state.failures));

    this.state.set(modelId, state);
  }

  getWaitUntilNextAvailableMs(): number {
    const now = Date.now();
    let min = Infinity;

    for (const state of this.state.values()) {
      if (state.cooldownUntil > now) {
        min = Math.min(min, state.cooldownUntil - now);
      }
    }

    return Number.isFinite(min) ? min : 1_000;
  }

  snapshot() {
    return this.models.map((model) => {
      const state = this.state.get(model.id);

      return {
        id: model.id,
        label: model.label,
        kind: model.kind,
        priority: model.priority,
        failures: state?.failures ?? 0,
        cooldownMs: Math.max(0, (state?.cooldownUntil ?? 0) - Date.now()),
        lastError: state?.lastError,
      };
    });
  }

  private defaultCooldownMs(status: number | undefined, failures: number): number {
    if (status === 429) {
      return Math.min(60_000, 5_000 * failures);
    }

    if (status === 503 || status === 529) {
      return Math.min(120_000, 10_000 * failures);
    }

    return Math.min(30_000, 2_000 * failures);
  }
}
