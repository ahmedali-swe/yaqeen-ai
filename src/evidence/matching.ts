// Used only for searching/scoring. Never modify stored or displayed source text.
export function normalizeForSearch(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
const stopWords = new Set(normalizeForSearch("من في على إلى عن ما لا لم لن كل هذا هذه هو هي ان أن إنما قال يقول كان الله رسول النبي صلى عليه وسلم القرآن سورة حديث تفسير the is are a an of to in and that with for").split(" "));
export function keywords(text: string): string[] {
  return [...new Set(normalizeForSearch(text).split(" ").map((word) => word.replace(/^[وف](?=(?:[بك]?ال))/u, "").replace(/^[بك](?=ال)/u, "")).filter((word) => word.length >= 3 && !stopWords.has(word)))];
}
export function lexicalScore(query: string, source: string): number {
  const a = normalizeForSearch(query), b = normalizeForSearch(source);
  if (!a || !b) return 0;
  const terms = keywords(a);
  if (!terms.length) return 0;
  if (a === b) return 1;
  if (a.length >= 10 && a.split(" ").length >= 2 && (` ${b} `.includes(` ${a} `) || ` ${a} `.includes(` ${b} `))) return 0.98;
  const available = new Set(keywords(b));
  const overlap = terms.filter((word) => available.has(word)).length;
  // Single shared generic words are insufficient to return a passage.
  if (overlap < 2 || overlap / terms.length < 0.6) return 0;
  return Math.min(0.9, 0.5 + 0.4 * overlap / terms.length);
}
