import "server-only";
import { ExtractionError } from "../errors";

export const GROQ_MAX_RETRIES = 2;
export const GROQ_MAX_RETRY_WAIT_MS = 8_000;
const retryable = new Set([429, 502, 503, 504]);

/** Retry-After is seconds or an HTTP date. Never retry earlier than requested. */
export function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (value === null || !value.trim()) return null;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const milliseconds = Number(value) * 1_000;
    return Number.isFinite(milliseconds) ? Math.ceil(milliseconds) : null;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

export function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new ExtractionError("AI_TIMEOUT"));
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new ExtractionError("AI_TIMEOUT")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** One policy for every Groq operation, inside the caller's existing deadline. */
export async function requestGroqWithRetry(request: () => Promise<Response>, signal: AbortSignal): Promise<Response> {
  let waited = 0;
  for (let attempt = 0; attempt <= GROQ_MAX_RETRIES; attempt++) {
    if (signal.aborted) throw new ExtractionError("AI_TIMEOUT");
    let response: Response;
    try { response = await request(); }
    catch { throw new ExtractionError(signal.aborted ? "AI_TIMEOUT" : "AI_UNAVAILABLE"); }
    if (response.ok) return response;
    const delay = retryAfterMs(response.headers.get("retry-after")) ?? Math.round(500 * 2 ** attempt + Math.random() * 250);
    const canRetry = retryable.has(response.status) && attempt < GROQ_MAX_RETRIES && delay <= GROQ_MAX_RETRY_WAIT_MS - waited;
    if (process.env.NODE_ENV === "development") console.error("[Yaqeen: Groq request failed]", {
      status: response.status, attempt: attempt + 1, retrying: canRetry, ...(canRetry ? { waitMs: delay } : {}),
    });
    // Provider bodies may echo secrets/input. Cancel them without reading/logging.
    await response.body?.cancel().catch(() => undefined);
    if (!canRetry) throw new ExtractionError("AI_UNAVAILABLE");
    waited += delay;
    await abortableDelay(delay, signal);
  }
  throw new ExtractionError("AI_UNAVAILABLE");
}
