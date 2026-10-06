import type { ExtractedClaim } from "./claim-extraction";

/** Narrow safety boundary, not a fatwa classifier: first-person religious applications. */
export function requiresPersonalSpecialist(claim: Pick<ExtractedClaim, "text" | "claimType">): boolean {
  const religious = /صلا[ةت]|صيام|صوم|زكا[ةت]|عباد[ةت]|فتوى|حلال|حرام|طلاق|تقبل|قبول|صحة|prayer|fasting|fatwa|halal|haram|divorce|worship/i.test(claim.text);
  const personal = /صلاتي|صيامي|صومي|زكاتي|عبادتي|طلاقي|نيتي|حكمي|(?:هل|يجوز|يجب).*(?:\sلي\b|عليّ|علي |أفعل|أنا)|\b(?:my|i|me)\b/i.test(claim.text);
  const application = claim.claimType === "RULING" || /(?:هل|أفتوني|ما حكم|فتوى)|\b(?:may|can|should|must|is)\b/i.test(claim.text);
  return religious && personal && application;
}
