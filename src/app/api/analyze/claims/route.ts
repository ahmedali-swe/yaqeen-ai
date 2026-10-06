import { z } from "zod";
import { extractClaims } from "@/ai/claim-extraction";
import { ExtractionError } from "@/ai/errors";
import { reserveExtraction } from "@/ai/request-limit";
import { MAX_TEXT_LENGTH, validateText } from "@/lib/input";

export const runtime = "nodejs";
export const maxDuration = 40;
const requestSchema = z.strictObject({ text: z.string().max(MAX_TEXT_LENGTH) });
const MAX_BODY_BYTES = 64 * 1024;
const errorStatus = { AI_NOT_CONFIGURED: 503, AI_TIMEOUT: 504, AI_UNAVAILABLE: 502, INVALID_AI_RESPONSE: 502 };
const failure = (code: string, status: number) => Response.json({ error: { code } }, { status, headers: { "Cache-Control": "no-store", ...(status === 429 ? { "Retry-After": "60" } : {}) } });

async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { reader.releaseLock(); }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return failure("INVALID_ORIGIN", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return failure("INVALID_CONTENT_TYPE", 415);
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return failure("INPUT_TOO_LARGE", 413);
  let text: string;
  try {
    const body = await readBody(request);
    if (body === null) return failure("INPUT_TOO_LARGE", 413);
    const parsed = requestSchema.safeParse(JSON.parse(body));
    if (!parsed.success || validateText(parsed.data.text)) return failure("INVALID_INPUT", 400);
    text = parsed.data.text;
  } catch { return failure("INVALID_INPUT", 400); }
  const release = reserveExtraction();
  if (!release) return failure("RATE_LIMITED", 429);
  try {
    const result = await extractClaims(text, undefined, request.signal);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ExtractionError) return failure(error.code, errorStatus[error.code]);
    return failure("AI_UNAVAILABLE", 502);
  } finally { release(); }
}
