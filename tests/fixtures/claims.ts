import type { ExtractedClaim } from "../../src/domain/claim-extraction";

/** Test-only fixtures; never imported by application code or seeded. */
export function claim(text: string, overrides: Partial<ExtractedClaim> = {}): ExtractedClaim {
  return {
    id: "provider-id", text, normalizedText: text, claimType: "GENERAL_CLAIM",
    subject: null, attributedTo: null, sourceMentioned: null, isVerifiable: true,
    verificationReason: "This statement can be checked against a relevant record.",
    originalStart: null, originalEnd: null, ...overrides,
  };
}
