/** Stable domain vocabulary. No verification engine is implemented. */
export const MutationType = {
  DIRECT_QUOTE: "DIRECT_QUOTE",
  PARAPHRASE: "PARAPHRASE",
  MISSING_CONTEXT: "MISSING_CONTEXT",
  OVERGENERALIZATION: "OVERGENERALIZATION",
  UNSUPPORTED_INFERENCE: "UNSUPPORTED_INFERENCE",
  MISATTRIBUTION: "MISATTRIBUTION",
  TRANSLATION_DRIFT: "TRANSLATION_DRIFT",
} as const;
export type MutationType = (typeof MutationType)[keyof typeof MutationType];

export const VerificationStatus = {
  SUPPORTED: "SUPPORTED",
  PARTIALLY_SUPPORTED: "PARTIALLY_SUPPORTED",
  NEEDS_CONTEXT: "NEEDS_CONTEXT",
  UNSUPPORTED: "UNSUPPORTED",
  REQUIRES_SPECIALIST: "REQUIRES_SPECIALIST",
} as const;
export type VerificationStatus = (typeof VerificationStatus)[keyof typeof VerificationStatus];

export interface SourceReference {
  id: string;
  approvedSourceId: string;
  title: string;
  author: string | null;
  locator: string;
  url: string | null;
  edition: string | null;
  accessedAt: string | null;
}

export interface Claim {
  id: string;
  analysisReportId: string;
  text: string;
  /** Original-input character span. Null until extraction is implemented. */
  inputSpan: { start: number; end: number } | null;
  verificationStatus: VerificationStatus | null;
}

export interface Evidence {
  id: string;
  sourceReferenceId: string;
  originalText: string;
  context: string | null;
  language: string;
  /** Dimension is intentionally undecided until an embedding model is chosen. */
  embedding: number[] | null;
  embeddingModel: string | null;
}

export interface EvidenceRelation {
  id: string;
  analysisReportId: string;
  claimId: string;
  evidenceId: string;
  predecessorRelationId: string | null;
  mutationType: MutationType;
  explanation: string;
  preservedText: string;
  publishedText: string;
}

export interface YaqeenPatch {
  id: string;
  analysisReportId: string;
  claimId: string;
  originalText: string;
  correctedText: string;
  rationale: string;
  evidenceIds: string[];
  /** A future correction must be reviewed before publication. */
  reviewedAt: string | null;
}

export interface AnalysisReport {
  id: string;
  inputType: "TEXT" | "IMAGE";
  processingStatus: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  createdAt: string;
  completedAt: string | null;
  claims: Claim[];
  evidence: Evidence[];
  sourceReferences: SourceReference[];
  evidenceRelations: EvidenceRelation[];
  patches: YaqeenPatch[];
}
