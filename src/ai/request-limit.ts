import "server-only";

// Small single-process budget guard, not a distributed/user-specific quota.
const state = globalThis as typeof globalThis & { extractionBudget?: { started: number[]; active: number } };
export function reserveExtraction(): (() => void) | null {
  const budget = state.extractionBudget ??= { started: [], active: 0 };
  const now = Date.now();
  budget.started = budget.started.filter((time) => now - time < 60_000);
  if (budget.active >= 3 || budget.started.length >= 15) return null;
  budget.started.push(now);
  budget.active += 1;
  return () => { budget.active -= 1; };
}
