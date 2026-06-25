import { FREE_SUMMARY_MODELS, type FreeModelProfile } from "./free-models.js";

export type ModelFailure = {
  status?: number;
  body?: unknown;
  retryAfterMs?: number;
};

type ModelState = {
  success: number;
  fail: number;
  fail429: number;
  schemaFail: number;
  latencyEwmaMs: number | null;
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
        success: 0,
        fail: 0,
        fail429: 0,
        schemaFail: 0,
        latencyEwmaMs: null,
        cooldownUntil: 0,
      });
    }
  }

  getRoute(limit = 5): string[] {
    const now = Date.now();
    const available = this.models
      .filter((model) => {
        const state = this.state.get(model.id);
        return !state || state.cooldownUntil <= now;
      })
      .sort((a, b) => this.score(b) - this.score(a));

    if (available.length === 0) {
      return [];
    }

    const cursor = this.cursor % available.length;
    const rotated = [...available.slice(cursor), ...available.slice(0, cursor)];

    return rotated.slice(0, limit).map((model) => model.id);
  }

  reportSuccess(modelId: string, latencyMs = 0): void {
    const state = this.getState(modelId);

    state.success += 1;
    state.latencyEwmaMs =
      state.latencyEwmaMs === null
        ? latencyMs
        : state.latencyEwmaMs * 0.8 + latencyMs * 0.2;
    state.cooldownUntil = 0;
    state.lastError = undefined;

    const index = this.models.findIndex((model) => model.id === modelId);

    if (index >= 0) {
      this.cursor = (index + 1) % this.models.length;
    }
  }

  reportFailure(modelId: string, failure: ModelFailure): void {
    const state = this.getState(modelId);

    state.fail += 1;
    if (failure.status === 429) {
      state.fail429 += 1;
    }
    state.lastError = JSON.stringify(failure.body ?? failure.status ?? "unknown");
    state.cooldownUntil =
      Date.now() +
      (failure.retryAfterMs ??
        this.defaultCooldownMs(failure.status, state.fail));

    this.state.set(modelId, state);
  }

  reportSchemaFailure(modelId: string): void {
    const state = this.getState(modelId);

    state.fail += 1;
    state.schemaFail += 1;
    state.cooldownUntil = Date.now() + 15_000;
    state.lastError = "schema_failure";
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
        success: state?.success ?? 0,
        fail: state?.fail ?? 0,
        fail429: state?.fail429 ?? 0,
        schemaFail: state?.schemaFail ?? 0,
        latencyEwmaMs: state?.latencyEwmaMs ?? null,
        cooldownMs: Math.max(0, (state?.cooldownUntil ?? 0) - Date.now()),
        lastError: state?.lastError,
        score: this.score(model),
      };
    });
  }

  private score(model: FreeModelProfile): number {
    const state = this.getState(model.id);
    const total = state.success + state.fail;
    const successRate = total === 0 ? 0.5 : state.success / total;
    const explorationBonus = total === 0 ? 1.5 : Math.max(0, 1 / total);
    const latencyPenalty =
      state.latencyEwmaMs === null
        ? 0
        : Math.min(10, Math.log1p(state.latencyEwmaMs / 1_000) * 4);

    return (
      model.priority +
      successRate * 10 -
      latencyPenalty -
      state.fail429 * 2 -
      state.schemaFail * 1.5 +
      explorationBonus
    );
  }

  private getState(modelId: string): ModelState {
    let state = this.state.get(modelId);

    if (!state) {
      state = {
        success: 0,
        fail: 0,
        fail429: 0,
        schemaFail: 0,
        latencyEwmaMs: null,
        cooldownUntil: 0,
      };
      this.state.set(modelId, state);
    }

    return state;
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
