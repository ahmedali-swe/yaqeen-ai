/** Single queue shared by relation and Patch. Failures never poison later calls. */
export class SequentialAiRunner {
  private tail: Promise<unknown> = Promise.resolve();
  private nextCall = 0;
  constructor(private readonly delayMs: number) {}
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const wait = Math.max(0, this.nextCall - Date.now());
      if (wait) await new Promise<void>((resolve) => setTimeout(resolve, wait));
      try { return await task(); }
      finally { this.nextCall = Date.now() + this.delayMs; }
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export function parseEvaluationArgs(raw: string[]) {
  const args = raw.filter((arg) => arg !== "--");
  let runs = 1, delayMs = 2_000, keyCases = false;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new Error("Duplicate evaluation option");
    seen.add(flag);
    if (flag === "--key-cases") keyCases = true;
    else if (flag === "--runs" && /^[1-3]$/.test(args[i + 1] ?? "")) runs = Number(args[++i]);
    else if (flag === "--delay-ms" && /^\d{1,5}$/.test(args[i + 1] ?? "") && Number(args[i + 1]) <= 30_000) delayMs = Number(args[++i]);
    else throw new Error("Usage: pnpm eval:live [-- --runs 1|2|3] [--key-cases] [--delay-ms 0..30000]");
  }
  return { runs, delayMs, keyCases: keyCases || runs > 1 };
}
