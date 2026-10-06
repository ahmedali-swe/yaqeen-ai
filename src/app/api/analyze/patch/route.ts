import { generateYaqeenPatch } from "@/ai/yaqeen-patch";
import { ExtractionError } from "@/ai/errors";
import { reserveExtraction } from "@/ai/request-limit";
import { PatchInputSchema, type PatchInput } from "@/domain/yaqeen-patch";
import { readBoundedBody } from "@/lib/read-bounded-body";
import { isValidRequestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const maxDuration = 40;
const MAX_BODY_BYTES = 1024 * 1024;
const errorStatus = { AI_NOT_CONFIGURED: 503, AI_TIMEOUT: 504, AI_UNAVAILABLE: 502, INVALID_AI_RESPONSE: 502 };
const failure = (code: string, status: number) => Response.json({ error: { code } }, { status, headers: { "Cache-Control": "no-store", ...(status === 429 ? { "Retry-After": "60" } : {}) } });

export async function POST(request: Request) {
  if (!isValidRequestOrigin(request)) return failure("INVALID_ORIGIN", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return failure("INVALID_CONTENT_TYPE", 415);
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return failure("INPUT_TOO_LARGE", 413);
  let input: PatchInput;
  try {
    const body = await readBoundedBody(request.body, MAX_BODY_BYTES);
    if (body === null) return failure("INPUT_TOO_LARGE", 413);
    const parsed = PatchInputSchema.safeParse(JSON.parse(body));
    if (!parsed.success) return failure("INVALID_INPUT", 400);
    input = parsed.data;
  } catch { return failure("INVALID_INPUT", 400); }
  const release = reserveExtraction();
  if (!release) return failure("RATE_LIMITED", 429);
  try { return Response.json(await generateYaqeenPatch(input, undefined, request.signal), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return failure(error instanceof ExtractionError ? error.code : "AI_UNAVAILABLE", error instanceof ExtractionError ? errorStatus[error.code] : 502); }
  finally { release(); }
}
