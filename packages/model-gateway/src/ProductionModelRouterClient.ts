import type { z } from "zod";
import type { ModelCallContext, ModelClient } from "./ModelClient.js";

export type ProductionModelTier = "cheap" | "default" | "quality";

export type ProductionModelRoute = {
  tier: ProductionModelTier;
  model: string;
  client: ModelClient;
};

export type ModelRouterEvent = {
  type: "selected" | "failed" | "circuit-opened" | "circuit-skipped";
  tier: ProductionModelTier;
  model: string;
  estimatedInputTokens: number;
  error?: unknown;
};

export type ProductionModelRouterClientOptions = {
  routes: ProductionModelRoute[];
  defaultMinInputTokens?: number;
  qualityMinInputTokens?: number;
  failureThreshold?: number;
  circuitCooldownMs?: number;
  estimateInputTokens?: (prompt: string) => number;
  onEvent?: (event: ModelRouterEvent) => void;
  now?: () => number;
};

type RouteState = {
  failures: number;
  openUntil: number;
};

const DEFAULT_TIER_MIN_INPUT_TOKENS = 2_000;
const QUALITY_TIER_MIN_INPUT_TOKENS = 12_000;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_CIRCUIT_COOLDOWN_MS = 30_000;

/**
 * Routes inexpensive prompts to the cheap tier and escalates harder or failed
 * requests toward the quality tier. Open circuits are retried after cooldown.
 */
export class ProductionModelRouterClient implements ModelClient {
  private readonly routes: Map<ProductionModelTier, ProductionModelRoute>;
  private readonly states = new Map<ProductionModelTier, RouteState>();

  constructor(private readonly options: ProductionModelRouterClientOptions) {
    this.routes = new Map(options.routes.map((route) => [route.tier, route]));

    for (const tier of tierOrder) {
      if (!this.routes.has(tier)) {
        throw new Error(`A ${tier} model route is required.`);
      }
      this.states.set(tier, { failures: 0, openUntil: 0 });
    }

    const defaultMin =
      options.defaultMinInputTokens ?? DEFAULT_TIER_MIN_INPUT_TOKENS;
    const qualityMin =
      options.qualityMinInputTokens ?? QUALITY_TIER_MIN_INPUT_TOKENS;
    if (defaultMin < 0 || qualityMin <= defaultMin) {
      throw new Error(
        "Router token thresholds must satisfy 0 <= default < quality.",
      );
    }
  }

  generateText(
    prompt: string,
    context?: ModelCallContext,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.execute(prompt, (client) =>
      client.generateText(prompt, context, signal),
    );
  }

  generateObject<T>(
    prompt: string,
    schema: z.ZodType<T>,
    context?: ModelCallContext,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.execute(prompt, (client) =>
      client.generateObject(prompt, schema, context, signal),
    );
  }

  private async execute<T>(
    prompt: string,
    operation: (client: ModelClient) => Promise<T>,
  ): Promise<T> {
    const estimatedInputTokens = (
      this.options.estimateInputTokens ?? estimateInputTokens
    )(prompt);
    const selectedTier = this.selectTier(estimatedInputTokens);
    const candidates = candidateOrder[selectedTier];
    let lastError: unknown;

    for (const tier of candidates) {
      const route = this.routes.get(tier)!;
      const state = this.states.get(tier)!;
      const now = (this.options.now ?? Date.now)();

      if (state.openUntil > now) {
        this.emit({
          type: "circuit-skipped",
          tier,
          model: route.model,
          estimatedInputTokens,
        });
        continue;
      }

      this.emit({
        type: "selected",
        tier,
        model: route.model,
        estimatedInputTokens,
      });

      try {
        const result = await operation(route.client);
        state.failures = 0;
        state.openUntil = 0;
        return result;
      } catch (error) {
        lastError = error;
        state.failures += 1;
        this.emit({
          type: "failed",
          tier,
          model: route.model,
          estimatedInputTokens,
          error,
        });

        if (
          state.failures >=
          (this.options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD)
        ) {
          state.openUntil =
            now +
            (this.options.circuitCooldownMs ?? DEFAULT_CIRCUIT_COOLDOWN_MS);
          this.emit({
            type: "circuit-opened",
            tier,
            model: route.model,
            estimatedInputTokens,
            error,
          });
        }
      }
    }

    throw lastError ?? new Error("No healthy model route is available.");
  }

  private selectTier(estimatedInputTokens: number): ProductionModelTier {
    if (
      estimatedInputTokens >=
      (this.options.qualityMinInputTokens ?? QUALITY_TIER_MIN_INPUT_TOKENS)
    ) {
      return "quality";
    }
    if (
      estimatedInputTokens >=
      (this.options.defaultMinInputTokens ?? DEFAULT_TIER_MIN_INPUT_TOKENS)
    ) {
      return "default";
    }
    return "cheap";
  }

  private emit(event: ModelRouterEvent): void {
    this.options.onEvent?.(event);
  }
}

const tierOrder: ProductionModelTier[] = ["cheap", "default", "quality"];

const candidateOrder: Record<ProductionModelTier, ProductionModelTier[]> = {
  cheap: ["cheap", "default", "quality"],
  default: ["default", "quality", "cheap"],
  quality: ["quality", "default", "cheap"],
};

function estimateInputTokens(prompt: string): number {
  // A conservative provider-independent estimate for mixed Cyrillic/Latin text.
  return Math.ceil(prompt.length / 3);
}
