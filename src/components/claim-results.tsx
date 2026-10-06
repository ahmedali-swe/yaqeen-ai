import type { ExtractedClaim } from "@/domain/claim-extraction";

const labels: Record<ExtractedClaim["claimType"], string> = {
  QUOTE: "اقتباس", RELIGIOUS_STATEMENT: "عبارة دينية", INTERPRETATION: "تفسير",
  RULING: "حكم شرعي", HISTORICAL_CLAIM: "ادعاء تاريخي", TRANSLATION: "ترجمة", GENERAL_CLAIM: "ادعاء عام",
};

export function ClaimResults({ claims, selectedId, onSelect }: { claims: ExtractedClaim[]; selectedId?: string; onSelect?: (id: string) => void }) {
  return <ol className="claim-list">{claims.map((claim, index) => <li key={claim.id} className={`claim-item ${selectedId === claim.id ? "is-selected" : ""}`}>
    <button type="button" className="claim-select" onClick={() => onSelect?.(claim.id)} aria-pressed={selectedId === claim.id} aria-label={`اختيار الادعاء ${(index + 1).toLocaleString("ar-SA")}`}>
      <span className="claim-type">{labels[claim.claimType]}</span>
      <span className="claim-wording" dir="auto">{claim.text}</span>
      <span className="claim-checkable">قابل للفحص{selectedId === claim.id && <span> · الادعاء المحدد</span>}</span>
    </button>
  </li>)}</ol>;
}
