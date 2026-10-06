export type ExtractionErrorCode = "AI_NOT_CONFIGURED" | "AI_TIMEOUT" | "AI_UNAVAILABLE" | "INVALID_AI_RESPONSE";

/** Only fixed codes cross the API boundary; provider diagnostics may contain secrets. */
export class ExtractionError extends Error {
  constructor(public readonly code: ExtractionErrorCode) {
    super(code);
    this.name = "ExtractionError";
  }
}
