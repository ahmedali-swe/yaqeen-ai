import "server-only";
import { createHash } from "node:crypto";
import { ExtractionError } from "./errors";

export type AiExecutionOptions = { cache?: boolean };
type Entry = { json: string; expiresAt: number; bytes: number };
type Pending = { promise: Promise<unknown>; controller: AbortController; subscribers: number };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function canonical(value: unknown, normalize: boolean): unknown {
  if (typeof value === "string") return normalize ? value.normalize("NFC").replace(/\s+/gu, " ").trim() : value;
  if (Array.isArray(value)) return value.map((item) => canonical(item, normalize));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item, normalize)]));
  return value;
}

/** No credentials in keys. Exact fingerprint protects wording, offsets and sources. */
export function aiRequestKey(operation: string, model: string, input: unknown): string {
  return digest(JSON.stringify({ version: 1, operation, model, normalizedInput: canonical(input, true), exactInputFingerprint: digest(JSON.stringify(canonical(input, false))) }));
}

/** Bounded process-local LRU; only fully validated service results enter it. */
export class AiResultCache {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Pending>();
  private bytes = 0;
  constructor(private readonly options = { ttlMs: 10 * 60_000, maxEntries: 100, maxBytes: 4 * 1024 * 1024, maxEntryBytes: 256 * 1024, maxPending: 32 }) {}

  private remove(key: string) {
    const value = this.entries.get(key);
    if (value) { this.bytes -= value.bytes; this.entries.delete(key); }
  }

  async run<T>(key: string, task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, execution: AiExecutionOptions = {}): Promise<T> {
    if (signal?.aborted) throw new ExtractionError("AI_TIMEOUT");
    const useCache = execution.cache !== false;
    const now = Date.now();
    for (const [id, entry] of this.entries) if (entry.expiresAt <= now) this.remove(id);
    const cached = useCache ? this.entries.get(key) : undefined;
    if (cached) {
      this.entries.delete(key); this.entries.set(key, cached);
      return JSON.parse(cached.json) as T;
    }
    // Cache-bypassed evaluations cannot share normal cached/in-flight work.
    const pendingKey = `${useCache ? "cached" : "fresh"}:${key}`;
    let work = this.pending.get(pendingKey);
    if (!work) {
      if (this.pending.size >= this.options.maxPending) throw new ExtractionError("AI_UNAVAILABLE");
      const controller = new AbortController();
      const entry: Pending = { controller, subscribers: 0, promise: Promise.resolve() };
      entry.promise = Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new ExtractionError("AI_TIMEOUT");
        return task(controller.signal);
      }).then((result) => {
        if (controller.signal.aborted) throw new ExtractionError("AI_TIMEOUT");
        if (useCache) {
          const json = JSON.stringify(result), bytes = Buffer.byteLength(json);
          const containsCredential = [process.env.GROQ_API_KEY, process.env.GEMINI_API_KEY].some((value) => value && json.includes(value));
          if (!containsCredential && bytes <= this.options.maxEntryBytes && bytes <= this.options.maxBytes) {
            this.remove(key);
            while (this.entries.size >= this.options.maxEntries || this.bytes + bytes > this.options.maxBytes) this.remove(this.entries.keys().next().value!);
            this.entries.set(key, { json, bytes, expiresAt: Date.now() + this.options.ttlMs }); this.bytes += bytes;
          }
        }
        return result;
      }).finally(() => { if (this.pending.get(pendingKey) === entry) this.pending.delete(pendingKey); });
      work = entry; this.pending.set(pendingKey, entry);
    }
    const shared = work;
    shared.subscribers++;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true; signal?.removeEventListener("abort", abort); shared.subscribers--;
        action();
        if (!shared.subscribers && this.pending.get(pendingKey) === shared) {
          shared.controller.abort(); this.pending.delete(pendingKey);
        }
      };
      const abort = () => finish(() => reject(new ExtractionError("AI_TIMEOUT")));
      signal?.addEventListener("abort", abort, { once: true });
      shared.promise.then((result) => finish(() => resolve(structuredClone(result) as T)), (error: unknown) => finish(() => reject(error)));
      if (signal?.aborted) abort();
    });
  }

  clear() {
    this.entries.clear(); this.bytes = 0;
    for (const work of this.pending.values()) work.controller.abort();
    this.pending.clear();
  }
}

const processState = globalThis as typeof globalThis & { yaqeenAiResults?: AiResultCache };
export const sharedAiResults = processState.yaqeenAiResults ??= new AiResultCache();
