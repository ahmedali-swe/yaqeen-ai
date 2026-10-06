import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeSahihaynDataset, SAHIHAYN_REVISION, type SahihaynCollection } from "../src/evidence/sahihayn-schema";
import { readBoundedBody } from "../src/lib/read-bounded-body";

const sources = [
  { collection: "bukhari", file: "Sahih al-Bukhari.json", sha256: "8183491ca95f28072254f84687a81fded4c484d3c54c1d0aa7e42191601af05d", count: 7277 },
  { collection: "muslim", file: "Sahih Muslim.json", sha256: "1484b90749b56444095a6bcec2532f001ae1a09226913484580fecf7e6fa55b8", count: 7368 },
] satisfies { collection: SahihaynCollection; file: string; sha256: string; count: number }[];
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--input-dir")) throw new Error("Usage: import-sahihayn.ts [--input-dir DIRECTORY]");
  const artifacts = [];
  // Validate both datasets and checksums before changing any production corpus file.
  for (const source of sources) {
    const url = `https://huggingface.co/datasets/meeAtif/hadith_datasets/resolve/${SAHIHAYN_REVISION}/${encodeURIComponent(source.file)}`;
    let raw: string;
    if (args.length) raw = await readFile(resolve(args[1], `${source.collection}.json`), "utf8");
    else {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Dataset download failed: HTTP ${response.status}`);
      const body = await readBoundedBody(response.body, 20 * 1024 * 1024);
      if (body === null) throw new Error("Dataset exceeds download bound");
      raw = body;
    }
    if (digest(raw) !== source.sha256) throw new Error(`Upstream checksum mismatch: ${source.collection}`);
    const records = normalizeSahihaynDataset(JSON.parse(raw), source.collection);
    if (records.length !== source.count) throw new Error(`Unexpected record count: ${source.collection}`);
    const normalized = `${JSON.stringify(records)}\n`;
    artifacts.push({ source, url, normalized, normalizedSha256: digest(normalized) });
  }
  const directory = resolve("data/hadith");
  await mkdir(directory, { recursive: true });
  for (const artifact of artifacts) await writeFile(resolve(directory, `${artifact.source.collection}.json`), artifact.normalized, "utf8");
  await writeFile(resolve(directory, "manifest.json"), `${JSON.stringify({
    dataset: "meeAtif/hadith_datasets", revision: SAHIHAYN_REVISION, declaredLicense: "MIT",
    files: artifacts.map(({ source, url, normalizedSha256 }) => ({ collection: source.collection, file: `${source.collection}.json`, records: source.count, upstreamUrl: url, upstreamSha256: source.sha256, normalizedSha256 })),
  }, null, 2)}\n`, "utf8");
  for (const { source, normalized } of artifacts) console.log(`${source.collection}: ${source.count} records, ${Buffer.byteLength(normalized)} bytes; Arabic_Text copied unchanged`);
}

main().catch(() => { console.error("Sahihayn import failed; check source shape, pinned checksums, count and local write permissions. No source text or secrets logged."); process.exitCode = 1; });
