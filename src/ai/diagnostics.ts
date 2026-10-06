import "server-only";

const names = new Set(["Error", "ApiError", "TypeError", "AggregateError", "AbortError", "TimeoutError"]);
const codes = new Set(["PERMISSION_DENIED", "UNAUTHENTICATED", "INVALID_ARGUMENT", "NOT_FOUND", "RESOURCE_EXHAUSTED", "INTERNAL", "UNAVAILABLE", "DEADLINE_EXCEEDED", "EACCES", "ENOTFOUND", "ECONNRESET", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"]);
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const allowed = (value: unknown, list: Set<string>) => typeof value === "string" && list.has(value) ? value : undefined;

/** No arbitrary messages, stacks, request bodies, URLs or credentials are logged. */
export function logGeminiFailure(error: unknown) {
  if (process.env.NODE_ENV !== "development") return;
  try {
    const item = object(error);
    let provider: Record<string, unknown> = {};
    if (typeof item.message === "string") {
      try { provider = object(object(JSON.parse(item.message)).error); } catch { /* Non-JSON failures remain generic. */ }
    }
    const cause = object(item.cause);
    const status = item.status ?? provider.code;
    console.error("[Yaqeen: Gemini request failed]", {
      status: typeof status === "number" && Number.isInteger(status) ? status : undefined,
      code: allowed(provider.status ?? item.code, codes),
      name: allowed(item.name, names) ?? "Error",
      message: provider.message === "Your project has been denied access. Please contact support."
        ? "Your project has been denied access. Please contact support."
        : "Gemini request failed; raw provider message omitted.",
      cause: item.cause ? { name: allowed(cause.name, names) ?? "Error", code: allowed(cause.code, codes), message: "Underlying request failed; raw cause omitted." } : undefined,
    });
  } catch { /* Diagnostics must never change the client-facing error mapping. */ }
}
