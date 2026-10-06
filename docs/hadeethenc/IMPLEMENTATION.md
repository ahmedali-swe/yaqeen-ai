# Approved explanation integration

Verified against official public documentation and real Arabic API responses on
2026-10-06. Production uses documented live search/detail, not a local HadeethEnc
index or demonstration-specific source-ID mapping. Full details are in
[SOURCE_PROVENANCE.md](../SOURCE_PROVENANCE.md).

## Observed live behavior

- Bukhari 1: official explanation 66511, phrase containment, exact source metadata.
- Bukhari 71: official explanation 5518, exact normalized text match.
- Muslim 223: equally strong 65004/66526 candidates safely rejected. Primary local
  evidence remains usable for restricted quote/text comparison.
- Bukhari 71 quotation: real Groq `SUPPORTED / DIRECT_QUOTE`.
- Bukhari 71 independent conclusion: real Groq `UNSUPPORTED / UNSUPPORTED_INFERENCE`.
- First real Patch request: `AI_UNAVAILABLE`, no correction fabricated. One later
  Patch-only retry reused those real saved analyses and returned HTTP 200.
- Actual Patch adds only an evidential qualification to the original proposition:

> لا يكفي هذا الحديث للاستدلال على أن كل من لم يتخصص في الفقه أو لم يكن لديه علم شرعي واسع فهذا دليل على أن الله لا يريد به خيرًا

The minimized edit replaces the original first word `كل` with
`لا يكفي هذا الحديث للاستدلال على أن كل`. Every other original character stays
unchanged. This is lack of entailment, not the opposite theological assertion.

See [source observations](live-source-validation.json) and [actual reasoning/Patch
observations](live-bukhari-71.json); the initial failure remains recorded.

## Files changed for this task

Existing unrelated repository changes were preserved. No religious corpus,
database, model, authentication or deployment settings were changed.

```text
package.json
README.md
docs/SOURCE_PROVENANCE.md
docs/hadeethenc/IMPLEMENTATION.md
docs/hadeethenc/live-source-validation.json
docs/hadeethenc/live-bukhari-71.json
scripts/validate-hadeethenc.ts
scripts/validate-hadeethenc-reasoning.ts
src/sources/registry.ts
src/sources/README.md
src/app/api/analyze/evidence/route.ts
src/evidence/types.ts
src/evidence/explanations/types.ts
src/evidence/explanations/matching.ts
src/evidence/explanations/hadeethenc.ts
src/domain/evidence-reasoning.ts
src/domain/yaqeen-patch.ts
src/ai/evidence-reasoning.ts
src/ai/evidence-reasoning-prompt.ts
src/ai/providers/groq-reasoning.ts
src/ai/yaqeen-patch.ts
src/ai/patch-prompt.ts
src/components/approved-explanation.tsx
src/components/evidence-card.tsx
src/components/evidence-results.tsx
src/components/relation-analysis.tsx
src/components/yaqeen-patch.tsx
src/components/analysis-empty-states.tsx
src/components/analysis-session.ts
tests/setup.ts
tests/ui.test.tsx
tests/report-ui.test.tsx
tests/evidence-ui.test.tsx
tests/evidence-api.test.ts
tests/yaqeen-patch.test.ts
tests/groq-reasoning.test.ts
tests/hadeethenc.test.ts
tests/hadeethenc-reasoning.test.ts
tests/hadeethenc-ui.test.tsx
tests/hadeethenc-api.test.ts
tests/fixtures/hadeethenc-intentions.json
tests/fixtures/hadeethenc-intentions-narration.json
tests/fixtures/hadeethenc-understanding.json
tests/fixtures/hadeethenc-purity.json
tests/fixtures/hadeethenc-search-intentions.json
tests/fixtures/hadeethenc-search-understanding.json
tests/fixtures/hadeethenc-search-purity.json
tests/fixtures/hadeethenc-provenance.json
tests/fixtures/hadeethenc-transport.ts
```

## Quality gate

Final full suite: **499 passing cases across 38 files** (442 existing cases plus
57 new regressions). **Lint, typecheck and production build passed.** Source tests
are network-independent and use captured official responses. Quality gates were
run separately from the small real source check. No broad live evaluation or
extra AI source summarization call is part of this integration. Remaining source
coverage limitation: equally strong narration variants safely abstain.
