import "server-only";
import { z } from "zod";
import { PatchResultSchema } from "@/domain/yaqeen-patch";
import { generateGroqStructuredOutput } from "./groq";
import { PATCH_INSTRUCTIONS } from "../patch-prompt";
import type { PatchProvider, ReadonlyPatchInput } from "../yaqeen-patch";
import { ExtractionError } from "../errors";
import { groundingPayload } from "../grounding-payload";

export function patchRequest(input: ReadonlyPatchInput) {
    const { $schema: dialect, ...schema } = z.toJSONSchema(PatchResultSchema);
    void dialect;
    const patch = schema.properties?.patch;
    if (!patch || typeof patch === "boolean" || !patch.properties) throw new ExtractionError("INVALID_AI_RESPONSE");
    const payload = groundingPayload(input, input.analysis);
    patch.properties.evidenceIds = { type: "array", maxItems: 1, items: { type: "string", enum: [payload.evidence[0].id] } };
    return { instructions: PATCH_INSTRUCTIONS, input: JSON.stringify({ ...payload, analysis: input.analysis }), schemaName: "yaqeen_patch", schema };
}
export const groqPatchProvider: PatchProvider = {
  generate(input, signal) { return generateGroqStructuredOutput(patchRequest(input), signal); },
};
