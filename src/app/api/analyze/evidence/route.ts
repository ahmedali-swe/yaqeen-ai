import { z } from "zod";
import { EvidenceRequestSchema } from "@/domain/claim-context";
import { retrieveEvidence } from "@/evidence/retriever";
import { resolveClaimEvidence } from "@/evidence/resolve";
import { EvidenceRetrievalError } from "@/evidence/types";
import { readBoundedBody } from "@/lib/read-bounded-body";
import { isValidRequestOrigin } from "@/lib/request-origin";
import { withApprovedExplanations } from "@/evidence/explanations/hadeethenc";

export const runtime = "nodejs";
export const maxDuration = 20;
const requestSchema = EvidenceRequestSchema;
const MAX_BODY_BYTES = 256 * 1024;
const budget = globalThis as typeof globalThis & { evidenceBudget?: { starts: number[]; active: number } };
const failure = (code: string, status: number) => Response.json({ error: { code } }, { status, headers: { "Cache-Control": "no-store", ...(status === 429 ? { "Retry-After": "60" } : {}) } });

export async function POST(request: Request) {
  if (!isValidRequestOrigin(request)) return failure("INVALID_ORIGIN", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return failure("INVALID_CONTENT_TYPE", 415);
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return failure("INPUT_TOO_LARGE", 413);
  let parsed: z.infer<typeof requestSchema>;
  try {
    const body = await readBoundedBody(request.body, MAX_BODY_BYTES);
    if (body === null) return failure("INPUT_TOO_LARGE", 413);
    parsed = requestSchema.parse(JSON.parse(body));
    if (!parsed.claim.text.trim()) return failure("INVALID_INPUT", 400);
  } catch { return failure("INVALID_INPUT", 400); }
  const state = budget.evidenceBudget ??= { starts: [], active: 0 };
  const now = Date.now();
  state.starts = state.starts.filter((time) => now - time < 60_000);
  if (state.active >= 3 || state.starts.length >= 30) return failure("RATE_LIMITED", 429);
  state.starts.push(now); state.active += 1;
  try {
    const result = parsed.context ? await resolveClaimEvidence(parsed.claim, parsed.context, request.signal) : await retrieveEvidence(parsed.claim, undefined, request.signal);
    const anchorClaim = parsed.context?.claims.find((claim) => claim.id === result.resolution?.evidenceAnchorClaimId);
    return Response.json(await withApprovedExplanations(result, anchorClaim?.text ?? parsed.claim.text), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof EvidenceRetrievalError) return failure(error.code, error.code === "EVIDENCE_TIMEOUT" ? 504 : 502);
    return failure("EVIDENCE_UNAVAILABLE", 502);
  } finally { state.active -= 1; }
}
