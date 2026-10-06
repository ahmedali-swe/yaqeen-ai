export interface ClaimExtractionProvider {
  extract(text: string, signal: AbortSignal): Promise<unknown>;
}
