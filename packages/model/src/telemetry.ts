export type OllamaTelemetry = {
  durationMs: number;
  status: "ok" | "error";
  error?: string;
};

export function withTelemetry(
  fetchImpl: typeof fetch,
  onCall: (event: OllamaTelemetry) => void,
): typeof fetch {
  return async (input, init) => {
    const startedAt = performance.now();
    try {
      const response = await fetchImpl(input, init);
      onCall({
        durationMs: performance.now() - startedAt,
        status: response.ok ? "ok" : "error",
        ...(!response.ok
          ? { error: `${response.status} ${response.statusText}` }
          : {}),
      });
      return response;
    } catch (error) {
      onCall({
        durationMs: performance.now() - startedAt,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}
