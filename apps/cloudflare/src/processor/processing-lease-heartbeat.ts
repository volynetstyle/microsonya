import { LeaseLostError } from "./failure-policy.js";

const LEASE_HEARTBEAT_MS = 30_000;

export async function withProcessingLeaseHeartbeat<T>(
  renewLease: () => Promise<boolean>,
  operation: () => Promise<T>,
): Promise<T> {
  let renewal = Promise.resolve(true);
  let leaseLost = false;
  const timer = setInterval(() => {
    renewal = renewal.then(async (previous) => {
      if (!previous) return false;
      const renewed = await renewLease();
      if (!renewed) leaseLost = true;
      return renewed;
    });
  }, LEASE_HEARTBEAT_MS);
  try {
    const result = await operation();
    await renewal;
    if (leaseLost) throw new LeaseLostError();
    return result;
  } finally {
    clearInterval(timer);
    await renewal;
  }
}
