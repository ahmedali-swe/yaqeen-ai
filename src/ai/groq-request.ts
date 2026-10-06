import { GroundingBudgetError } from "./grounding-payload";

// Complete UTF-8 body: messages, JSON escaping, strict schema and transport fields.
// Conservative application limit, not a claim about Groq's tokenizer/rate limits.
export const MAX_GROQ_GROUNDING_REQUEST_BYTES = 18_000;
export type StructuredRequest = { instructions: string; input: string; schemaName: string; schema: Record<string, unknown> };
export function serializeGroqRequest(options: StructuredRequest, model: string) {
  return JSON.stringify({ model, messages: [{ role: "system", content: options.instructions }, { role: "user", content: options.input }],
    response_format: { type: "json_schema", json_schema: { name: options.schemaName, strict: true, schema: options.schema } },
    max_completion_tokens: 16_384, temperature: 0, stream: false });
}
export function requestMeasurements(options: StructuredRequest, serialized: string) {
  const input = JSON.parse(options.input);
  const evidence = input.evidence ?? [], explanations = input.approvedExplanations ?? [];
  const originalContent = (input.originalContent ?? "").length;
  const claim = JSON.stringify(input.claim ?? null).length;
  const evidenceText = evidence.reduce((sum: number, item: { exactText: string }) => sum + item.exactText.length, 0);
  const approvedExplanation = explanations.reduce((sum: number, item: { exactExplanation?: string; segments?: { text: string }[] }) => sum + (item.exactExplanation?.length ?? item.segments?.reduce((count, segment) => count + segment.text.length, 0) ?? 0), 0);
  const hints = explanations.reduce((sum: number, item: { hints?: string[] }) => sum + (item.hints?.join("").length ?? 0), 0);
  return { operation: options.schemaName, bytes: Buffer.byteLength(serialized, "utf8"), originalContent, claim, evidenceText, approvedExplanation, hints,
    other: options.input.length - originalContent - claim - evidenceText - approvedExplanation - hints, evidenceCandidates: evidence.length };
}
export function prepareGroundingRequest(options: StructuredRequest, model: string) {
  let serialized = serializeGroqRequest(options, model);
  if (Buffer.byteLength(serialized, "utf8") > MAX_GROQ_GROUNDING_REQUEST_BYTES) {
    const payload = JSON.parse(options.input);
    // Remove optional surrounding prose only. The separate anchor/connector,
    // original claim, exact source and selected explanation are never shortened.
    payload.originalContent = null;
    serialized = serializeGroqRequest({ ...options, input: JSON.stringify(payload) }, model);
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_GROQ_GROUNDING_REQUEST_BYTES) {
    if (process.env.NODE_ENV === "development") console.info("[Yaqeen: grounding budget exceeded]", requestMeasurements({ ...options, input: JSON.parse(serialized).messages[1].content }, serialized));
    throw new GroundingBudgetError();
  }
  return serialized;
}
