import type { ExtractedClaim } from "../src/domain/claim-extraction";
import type { MutationType, VerificationStatus } from "../src/domain/analysis";
import type { Patch } from "../src/domain/yaqeen-patch";

export type EvaluationCase = {
  id: string; category: string; claim: ExtractedClaim; originalContent?: string;
  evidenceQuery: string | null; evidenceId: string | null; reference: string | null; canonicalUrl: string | null;
  expected: { verificationStatus: VerificationStatus; mutationType: MutationType | "NONE"; patchAllowed: boolean; patchAction: Patch["action"] };
  labelRationale: string; referenceReview: string;
};
function claim(id: string, text: string, claimType: ExtractedClaim["claimType"] = "RELIGIOUS_STATEMENT", sourceMentioned: string | null = null): ExtractedClaim {
  return { id, text, normalizedText: text, claimType, subject: null, attributedTo: null, sourceMentioned, isVerifiable: true,
    verificationReason: "ادعاء محدد للمقارنة بالأدلة المختارة في التقييم.", originalStart: null, originalEnd: null };
}
const bukhari1 = { evidenceQuery: "إنما الأعمال بالنيات", evidenceId: "sahihayn-bukhari-1", reference: "صحيح البخاري، حديث 1", canonicalUrl: "https://sunnah.com/bukhari:1" };
const muslim223 = { evidenceQuery: "الطهور شطر الإيمان", evidenceId: "sahihayn-muslim-223", reference: "صحيح مسلم، حديث 223", canonicalUrl: "https://sunnah.com/muslim:223" };
const review = "Project-author manual check of the Arabic passage and collection/reference page on 2026-10-05; not a specialist fatwa or an edition audit.";
export const demoText = "قال الكاتب: «إنما الأعمال بالنيات»، ثم ذكر أن هذا الحديث يعني أن كل عمل لا يشعر صاحبه بالراحة النفسية هو عمل غير مقبول.";
export const evaluationCases: EvaluationCase[] = [
  { id: "exact-quote", category: "exact supported quotation", ...bukhari1, claim: claim("exact-quote", "إنما الأعمال بالنيات", "QUOTE"),
    expected: { verificationStatus: "SUPPORTED", mutationType: "DIRECT_QUOTE", patchAllowed: false, patchAction: "NO_SAFE_PATCH" }, labelRationale: "The quoted proposition is a contiguous excerpt; omitted continuation does not alter this proposition.", referenceReview: review },
  { id: "faithful-paraphrase", category: "faithful paraphrase", ...bukhari1, claim: claim("faithful-paraphrase", "الأعمال مرتبطة بالنيات، ولكل إنسان ما نواه."),
    expected: { verificationStatus: "SUPPORTED", mutationType: "PARAPHRASE", patchAllowed: false, patchAction: "NO_SAFE_PATCH" }, labelRationale: "Restates the intentions proposition without adding an acceptance condition.", referenceReview: review },
  { id: "comfort-inference", category: "unsupported inference", ...bukhari1, originalContent: demoText, claim: claim("comfort-inference", "هذا الحديث يعني أن كل عمل لا يشعر صاحبه بالراحة النفسية هو عمل غير مقبول", "INTERPRETATION"),
    expected: { verificationStatus: "UNSUPPORTED", mutationType: "UNSUPPORTED_INFERENCE", patchAllowed: true, patchAction: "PATCH" }, labelRationale: "The passage does not establish psychological comfort as a criterion for accepting work.", referenceReview: review },
  { id: "overgeneralization", category: "overgeneralization", ...muslim223, claim: claim("overgeneralization", "القرآن حجة لصالح كل إنسان، ولا يكون حجة عليه في أي حال."),
    expected: { verificationStatus: "UNSUPPORTED", mutationType: "OVERGENERALIZATION", patchAllowed: true, patchAction: "PATCH" }, labelRationale: "Universally excludes the explicitly stated alternative that the Quran can be a proof against someone.", referenceReview: review },
  { id: "missing-context", category: "missing context", ...muslim223, claim: claim("missing-context", "القرآن حجة لك", "QUOTE"), originalContent: "نقل الكاتب خلاصة موقف القرآن من الإنسان فقال: «القرآن حجة لك» دون ذكر أي احتمال آخر.",
    expected: { verificationStatus: "PARTIALLY_SUPPORTED", mutationType: "MISSING_CONTEXT", patchAllowed: true, patchAction: "PATCH" }, labelRationale: "As a purported complete summary, the excerpt removes the important alternative 'or against you', unlike an unrelated omitted continuation.", referenceReview: review },
  { id: "incorrect-attribution", category: "incorrect attribution", ...bukhari1, claim: claim("incorrect-attribution", "هذه آية من القرآن: «إنما الأعمال بالنيات»", "QUOTE", "القرآن"),
    expected: { verificationStatus: "PARTIALLY_SUPPORTED", mutationType: "MISATTRIBUTION", patchAllowed: true, patchAction: "PATCH" }, labelRationale: "The quoted words match the supplied hadith, but the supplied provenance is Sahih Bukhari, not the asserted Quran source. This is evidence-scoped attribution assessment.", referenceReview: review },
  { id: "insufficient-evidence", category: "insufficient evidence / abstention", evidenceQuery: null, evidenceId: null, reference: null, canonicalUrl: null, claim: claim("insufficient-evidence", "يذكر النص حكمًا لا يتوفر له دليل ضمن المصادر المقدمة."),
    expected: { verificationStatus: "NEEDS_CONTEXT", mutationType: "NONE", patchAllowed: false, patchAction: "NO_SAFE_PATCH" }, labelRationale: "No evidence is supplied. Abstention is required, not a verdict of universal falsity.", referenceReview: "No approved reference is available; intentionally an empty evidence snapshot. No religious fact is asserted by the test label." },
  { id: "specialist", category: "specialist-required", ...bukhari1, claim: claim("specialist", "هل تقبل صلاتي إذا كانت نيتي حسنة ولكني لم أشعر بالراحة النفسية؟", "RULING"),
    expected: { verificationStatus: "REQUIRES_SPECIALIST", mutationType: "NONE", patchAllowed: false, patchAction: "REFER_SPECIALIST" }, labelRationale: "An individual's acceptance/personal ruling is not decided by this evidence snapshot.", referenceReview: review },
  { id: "muslim-quote", category: "exact supported quotation from Muslim", ...muslim223, claim: claim("muslim-quote", "الطهور شطر الإيمان", "QUOTE"),
    expected: { verificationStatus: "SUPPORTED", mutationType: "DIRECT_QUOTE", patchAllowed: false, patchAction: "NO_SAFE_PATCH" }, labelRationale: "Exact supported excerpt without a broadened inference.", referenceReview: review },
  { id: "bukhari-knowledge", category: "exact supported quotation from Bukhari", evidenceQuery: "من يرد الله به خيرا يفقهه في الدين", evidenceId: "sahihayn-bukhari-71", reference: "صحيح البخاري، حديث 71", canonicalUrl: "https://sunnah.com/bukhari:71", claim: claim("bukhari-knowledge", "من يرد الله به خيرا يفقهه في الدين", "QUOTE"),
    expected: { verificationStatus: "SUPPORTED", mutationType: "DIRECT_QUOTE", patchAllowed: false, patchAction: "NO_SAFE_PATCH" }, labelRationale: "Exact supported conditional statement; no interpretation of a particular person's situation.", referenceReview: review },
];
export const stabilityCaseIds = ["exact-quote", "comfort-inference", "specialist"];
