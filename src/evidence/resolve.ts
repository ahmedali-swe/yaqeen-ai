import "server-only";
import { EvidenceRequestSchema, resolveEvidenceAnchor, type ClaimContext } from "@/domain/claim-context";
import type { ExtractedClaim } from "@/domain/claim-extraction";
import { retrieveEvidence } from "./retriever";
import { EvidenceRetrievalError, type EvidenceResult } from "./types";

/** Evidence can be inherited for comparison. This module has no verdict input. */
export async function resolveClaimEvidence(claim: ExtractedClaim, context: ClaimContext, parentSignal?: AbortSignal, retrieve: typeof retrieveEvidence = retrieveEvidence): Promise<EvidenceResult> {
  const input = EvidenceRequestSchema.parse({ claim, context });
  const signal = AbortSignal.any([...(parentSignal ? [parentSignal] : []), AbortSignal.timeout(16_000)]);
  const direct = await retrieve(input.claim, undefined, signal);
  if (signal.aborted) throw new EvidenceRetrievalError("EVIDENCE_TIMEOUT");
  if (direct.evidence.length) return { ...direct, resolution: { evidenceOrigin: "DIRECT", evidenceAnchorClaimId: null } };
  const anchor = resolveEvidenceAnchor(input.claim, input.context!.claims, input.context!.originalContent);
  if (!anchor) return { ...direct, resolution: { evidenceOrigin: "DIRECT", evidenceAnchorClaimId: null } };
  const anchorClaim = input.context!.claims.find((item) => item.id === anchor.evidenceAnchorClaimId)!;
  const referenced = await retrieve(anchorClaim, undefined, signal);
  if (signal.aborted) throw new EvidenceRetrievalError("EVIDENCE_TIMEOUT");
  const evidence = referenced.evidence.filter((item) => anchor.sourceType === "TEXT" || (anchor.sourceType === "HADITH" ? item.sourceType === "HADITH" : item.sourceType !== "HADITH"));
  return evidence.length ? { ...referenced, evidence, resolution: { evidenceOrigin: "CONTEXTUAL_ANCHOR", evidenceAnchorClaimId: anchorClaim.id } }
    : { ...direct, resolution: { evidenceOrigin: "DIRECT", evidenceAnchorClaimId: null } };
}
