# Submission acceptance and changed files

## Reliability follow-up: current results

- Lint and typecheck passed; **374 tests in 29 files** passed; production build passed.
- Extraction, relation and Patch share bounded transient-only retries, in-flight
  deduplication and a ten-minute bounded successful-result cache. Input/source
  fingerprints, caller isolation, cancellation, credential exclusion and
  validation-before-caching are tested.
- Real cache-bypassed three-case smoke evaluation: provider availability **1/2**;
  AI status/mutation each **1/1** on the valid result; one deterministic referral;
  end-to-end expected-outcome success **2/3**. Comfort inference returned actual
  HTTP 429 and no result. The live command exited 1, not a passing gate.
- Final secret scan found no configured key in tracked/unignored files or browser
  assets; no private environment file is tracked. The model and dependencies were
  not changed. The local source files remain unchanged.

See [version-2 methodology and complete outputs](EVALUATION.md) and
[key-live-results.json](evaluation/key-live-results.json). Earlier quota-limited
observations were recomputed without making new calls or changing labels. Their
original reports are retained.

## Previous competition-closure quality gates (historical)

- Lint: passed, no warnings.
- Typecheck: passed.
- Network-independent automated tests: **333 passed in 26 files**.
- Production build: passed; extraction, evidence, relation, Patch and health are
  Node routes. Source tracing includes both corpus files in evidence/Patch/health.
- Last error-free full evaluation: 10 cases, 10/10 status and mutation labels,
  baseline 5/10. This was before the final additional verbatim-quotation Patch
  guard; its exact report is retained separately. The final rerun encountered
  actual Groq HTTP 429 failures; see EVALUATION.md and the latest live report.
- Previous final live rerun: **exited 1**, five completed observations and five
  exhausted HTTP 429 failures. Corrected provider availability is 3/8; semantic
  status/mutation/Patch decisions are each 5/5 valid results; end-to-end success is 5/10.
  No missing output was replaced with a fake result. Quota recovery is the
  remaining external blocker to a green final live evaluation gate.
- Real three-run key-case check: 9/9 expected classifications; three real comfort
  patches, unchanged quotations, deterministic specialist referral; no provider errors.

See the [full method and retained earlier results](EVALUATION.md). These tiny,
selected, project-author labels are not an expert-certified general accuracy claim.

## Actual production API acceptance

The built application was run locally with the configured server-side Groq key
and `DORAR_ENABLED=false`. Requests used the exact scenario-1 text and real extracted
claims, not test fixtures or mocked provider results. Paid calls were paced for
the account's token quota. Public inputs/results are in
[api-acceptance.json](evaluation/api-acceptance.json).

Observed sequence:

1. Health: HTTP 200, configuration and local corpus ready; no external health probe.
2. Extraction: HTTP 200, two independent claims.
3. Retrieval: HTTP 200, local `sahihayn-bukhari-1`, Dorar disabled, no live search.
4. Quotation: HTTP 200, `SUPPORTED / DIRECT_QUOTE`; Patch `NO_SAFE_PATCH` because
   no correction is needed.
5. Interpretation: HTTP 200, `UNSUPPORTED / UNSUPPORTED_INFERENCE`, citing Bukhari 1.
6. Real Patch: HTTP 200, `PATCH`, replacing only the unsupported proposition:

   Before: «هذا الحديث يعني أن كل عمل لا يشعر صاحبه بالراحة النفسية هو عمل غير مقبول»

   After: «هذا الحديث يعني أن الأعمال بالنيات»

   Changed segment: «كل عمل لا يشعر صاحبه بالراحة النفسية هو عمل غير مقبول»
   → «الأعمال بالنيات». Evidence: `sahihayn-bukhari-1`.

   The author's reporting prefix, original input, religious quotation and source
   passage remain unchanged. This is a proposed wording correction for review,
   not a personal ruling or a publication action.

The repeated relation call and its manual retry returned HTTP 502 with sanitized
`AI_UNAVAILABLE`; neither produced a fabricated result. The separate live
evaluation observed explicit provider HTTP 429 responses. The API failure record
does not expose enough detail to assign an exact provider cause to that call.

The final build's health, fresh retrieval/immutability check, unrelated retrieval,
no-evidence relation and no-evidence Patch all returned HTTP 200. Unrelated
retrieval returned no candidates; absent evidence produced `NEEDS_CONTEXT / NONE`
and `NO_SAFE_PATCH`. Fresh retrieved evidence matched the original candidate JSON
exactly. `completed` in the record means all acceptance checks were performed;
`repeatSucceeded: false` preserves the external failure. Refresh clears UI memory;
no report is saved by the application itself.

## Real provider failure

An isolated production process used a deliberately invalid **test** key. Actual
Groq returned HTTP 401; `/api/analyze/claims` returned HTTP 502 with exactly
`{"error":{"code":"AI_UNAVAILABLE"}}`, no claims, key, provider body or fake result.
No real environment file was changed. See [provider-failure.json](evaluation/provider-failure.json).
Automated tests additionally cover timeouts, malformed structured output, unbound
IDs, corrupted sources, request limits, stale responses and unavailable optional
Dorar. Health is configuration/integrity readiness, not certification of live key
validity or provider availability.

## Safety and deployment audit

- Religious evidence comes from approved source adapters, never the LLM. Collection
  and actual reference are shown; the dataset host is not a religious authority.
- The index preserves exact imported Arabic; blank grade/narrator/edition metadata
  stays unknown. Manual demo/reference checks and provenance limits are documented.
- Patch authenticates local evidence, discards forged metadata, cites IDs and
  reconstructs the proposed text from bounded edits. Religious quotation changes
  require exact retrieved wording, including unmarked `QUOTE` claims. If that
  cannot be met, Patch abstains. Structural checks are not scholarly certification.
- Missing evidence abstains; explicit personal applications refer without a ruling;
  provider failure produces no result. Evidence reuse never copies a verdict.
- Paid provider calls remain server-only. Source/metadata immutability and abort
  during source authentication are covered by regression tests.
- No unfinished image feature is visible. No chatbot, authentication,
  embeddings, new religious collection or unrelated database feature was added.
- Core demo needs no Docker/PostgreSQL, localhost service, runtime filesystem writes
  or Dorar availability. CLI evaluation writes public reports only as an offline
  development action; application functions do not write files.
- Secret-value scan of tracked/unignored workspace files and production client
  assets found no configured API key. No private `.env` is tracked. The example
  environment contains blank AI keys; production errors/logs remain sanitized.
- Local Vercel-compatible build/tracing is verified. **No hosted deployment was
  performed**; set platform secrets and perform the hosted health/scenario smoke
  test. Per-process budgets are not distributed quotas; public abuse controls are
  a hosting setting. External availability, index provenance and model judgment
  remain documented operational limitations.

## Exact files changed for previous submission closure

Earlier unrelated working-tree changes were preserved. This task changed/created:

```text
.env.example
README.md
next.config.ts
package.json
vitest.config.ts
data/hadith/README.md
src/domain/evidence-reasoning.ts
src/domain/specialist-boundary.ts
src/domain/yaqeen-patch.ts
src/ai/evidence-reasoning.ts
src/ai/evidence-reasoning-prompt.ts
src/ai/patch-prompt.ts
src/ai/yaqeen-patch.ts
src/ai/providers/groq-reasoning.ts
src/ai/providers/groq-patch.ts
src/evidence/providers/local-sahihayn.ts
src/app/api/analyze/patch/route.ts
src/app/api/health/route.ts
src/app/page.tsx
src/app/globals.css
src/components/content-input.tsx
src/components/analysis-empty-states.tsx
src/components/analysis-results.tsx
src/components/evidence-results.tsx
src/components/relation-analysis.tsx
src/components/yaqeen-patch.tsx
src/components/site-footer.tsx
src/sources/README.md
evaluation/cases.ts
evaluation/metrics.ts
scripts/evaluate-live.ts
tests/ui.test.tsx
tests/evidence-ui.test.tsx
tests/relation-ui.test.tsx
tests/groq-reasoning.test.ts
tests/yaqeen-patch.test.ts
tests/patch-api.test.ts
tests/health.test.ts
tests/evaluation.test.ts
tests/patch-ui.test.tsx
docs/SOURCE_PROVENANCE.md
docs/EVALUATION.md
docs/DEMO_SCENARIOS.md
docs/JUDGING_ALIGNMENT.md
docs/ACCEPTANCE.md
docs/evaluation/live-results.json
docs/evaluation/stability-results.json
docs/evaluation/api-acceptance.json
docs/evaluation/provider-failure.json
docs/evaluation/initial-live-results.json
docs/evaluation/transport-failed-results.json
docs/evaluation/pre-binding-live-results.json
docs/evaluation/pre-binding-stability-results.json
docs/evaluation/pre-binding-api-acceptance.json
docs/evaluation/pre-quote-guard-live-results.json
```

The Bukhari/Muslim indexing JSON, database schema and dependency lockfile were not
changed in this task. No dependency was added. Live evaluation labels remained at
version 1; earlier failed/variant runs were retained instead of relabeling them.

## Files changed in the reliability follow-up

```text
README.md
next-env.d.ts
docs/ACCEPTANCE.md
docs/EVALUATION.md
src/ai/providers/groq.ts
src/ai/providers/groq-retry.ts
src/ai/result-cache.ts
src/ai/claim-extraction.ts
src/ai/evidence-reasoning.ts
src/ai/yaqeen-patch.ts
src/lib/ai-messages.ts
src/components/content-input.tsx
src/components/relation-analysis.tsx
src/components/yaqeen-patch.tsx
evaluation/metrics.ts
evaluation/runner.ts
scripts/evaluate-live.ts
tests/setup.ts
tests/configured-provider.test.ts
tests/groq.test.ts
tests/groq-reasoning.test.ts
tests/ui.test.tsx
tests/patch-ui.test.tsx
tests/evaluation.test.ts
tests/groq-retry.test.ts
tests/ai-result-cache.test.ts
tests/ai-service-cache.test.ts
docs/evaluation/live-results.json
docs/evaluation/stability-results.json
docs/evaluation/key-live-results.json
docs/evaluation/legacy-rate-limited-results.json
docs/evaluation/legacy-stability-results.json
```

`next-env.d.ts` was updated by Next.js route/type generation during the checks.
