import { analyzeEvidenceRelation } from "@/ai/evidence-reasoning";
import { ExtractionError } from "@/ai/errors";
import { reserveExtraction } from "@/ai/request-limit";
import { RelationInputSchema, type RelationInput } from "@/domain/evidence-reasoning";
import { readBoundedBody } from "@/lib/read-bounded-body";

export const runtime = "nodejs";
export const maxDuration = 40;
const MAX_BODY_BYTES = 1024 * 1024;
const errorStatus = { AI_NOT_CONFIGURED: 503, AI_TIMEOUT: 504, AI_UNAVAILABLE: 502, INVALID_AI_RESPONSE: 502 };
const failure = (code: string, status: number) => Response.json({ error: { code } }, { status, headers: { "Cache-Control": "no-store", ...(status === 429 ? { "Retry-After": "60" } : {}) } });

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return failure("INVALID_ORIGIN", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return failure("INVALID_CONTENT_TYPE", 415);
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return failure("INPUT_TOO_LARGE", 413);
  let input: RelationInput;
  try {
    const body = await readBoundedBody(request.body, MAX_BODY_BYTES);
    if (body === null) return failure("INPUT_TOO_LARGE", 413);
    const result = RelationInputSchema.safeParse(JSON.parse(body));
    if (!result.success) return failure("INVALID_INPUT", 400);
    input = result.data;
  } catch { return failure("INVALID_INPUT", 400); }
  // Share the existing paid-AI budget with extraction to bound aggregate usage.
  const release = reserveExtraction();
  if (!release) return failure("RATE_LIMITED", 429);
  try {
    return Response.json(await analyzeEvidenceRelation(input, undefined, request.signal), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ExtractionError) return failure(error.code, errorStatus[error.code]);
    return failure("AI_UNAVAILABLE", 502);
  } finally { release(); }
}
