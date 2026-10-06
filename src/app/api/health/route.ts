import { requireAiProviderEnv, requireGroqEnv } from "@/lib/env";
import { checkSahihaynCorpus } from "@/evidence/providers/local-sahihayn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let aiConfigured = false, localCorpus = false;
  try { aiConfigured = requireAiProviderEnv(process.env).AI_PROVIDER === "groq" && Boolean(requireGroqEnv(process.env)); } catch { /* Readiness only; no secret details. */ }
  try { await checkSahihaynCorpus(); localCorpus = true; } catch { /* Safe readiness state. */ }
  return Response.json({ status: aiConfigured && localCorpus ? "ready" : "degraded", checks: { aiConfigured, localCorpus }, externalServicesProbed: false }, {
    status: aiConfigured && localCorpus ? 200 : 503, headers: { "Cache-Control": "no-store" },
  });
}
