/** Registry entries require editorial approval before any future ingestion. */
export interface ApprovedSource {
  id: string;
  title: string;
  category: "QURAN" | "HADITH" | "TAFSIR" | "SCHOLARLY_REFERENCE";
  canonicalUrl: string;
  language: string;
  edition: string;
  licenseNotes: string;
  approvedBy: string;
  approvedAt: string;
  scopeNotes: string;
}
