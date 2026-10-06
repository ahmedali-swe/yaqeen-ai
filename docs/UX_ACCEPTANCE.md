# Final UX and contextual-evidence acceptance

## Implemented boundary

The extraction schema, model, approved source corpus and Patch safety checks are
unchanged. An optional evidence-request `context` carries the actual extracted
claims and original content. A deterministic domain anchor recognizes explicit
Arabic references to the immediately preceding quote/religious statement. It
checks IDs, exact spans, chronology, a short reporting bridge and source kind.
Unrelated, ambiguous, later, cross-paragraph and invented anchors are rejected.

Retrieval tries the selected claim directly first. An empty result can resolve
the anchor's evidence through the existing approved retriever. The wrapper labels
it `CONTEXTUAL_ANCHOR`; source text and metadata stay untouched. The resolver has
no verdict input. Reasoning receives a separate selected claim and the evidence,
never the other claim's verdict. Both retrievals share a bounded deadline.

## Actual live browser run

Input:

> قال الكاتب: «إنما الأعمال بالنيات»، ثم ذكر أن هذا الحديث يعني أن كل عمل لا يشعر صاحبه بالراحة النفسية هو عمل غير مقبول.

The isolated Chrome browser submitted through the real production UI at
`http://localhost:3100`. Dorar was disabled for this run, as documented for the
bundled-corpus demonstration. All AI requests used the existing configured Groq
model. No responses were substituted in this live run.

The retained [live transcript](ux-acceptance/live-flow.json) records:

| Stage | Actual response |
| --- | --- |
| Extraction | HTTP 200; two independent claims, quotation and interpretation |
| Quote evidence | HTTP 200; `sahihayn-bukhari-1`, direct origin |
| Quote reasoning | HTTP 200; `SUPPORTED / DIRECT_QUOTE` |
| Interpretation evidence | HTTP 200; the same exact Bukhari evidence, `CONTEXTUAL_ANCHOR`, anchor `claim-1` |
| Interpretation reasoning | Initial HTTP 502 `AI_UNAVAILABLE`; explicit retry succeeded with HTTP 200 `UNSUPPORTED / UNSUPPORTED_INFERENCE` |
| Interpretation excess | The original comfort proposition, including “كل عمل لا يشعر صاحبه بالراحة النفسية هو عمل غير مقبول” |
| Fresh Patch | Three HTTP 502 `AI_UNAVAILABLE` results, with 65-second gaps between explicit retries |

A separate conservative invocation of the same Patch service with these actual
inputs and development diagnostics confirmed upstream **HTTP 429**. No key,
provider error body or secret was printed. The retry policy declined an automatic
retry outside its bounded wait. This is a provider-availability blocker, not a
semantic classification failure or a valid `NO_SAFE_PATCH` decision. No new live
Patch was generated in this run. The UI preserved evidence and reasoning and
offered retry only for the failed Patch stage.

The ordinary browser never displayed provider names, status codes, enums, private
messages or stack traces. English extraction helper fields remained hidden.
References point to the approved [Bukhari 1 page](https://sunnah.com/bukhari:1),
with **عرض المرجع**, rather than presenting a dataset host as religious authority.

## Visual and keyboard checks

The preferred browser-control runtime could not initialize: `failed to write
kernel assets ... (os error 3)`. The fallback used temporary Playwright tooling
and the existing Chrome installation against the production application. There
is no new product dependency.

Landing screenshots came from the real app. The fully expanded report and Patch
were checked with an **explicit visual-regression replay** of retained real
responses, without new AI calls. Reasoning/evidence are from the live transcript
above; the successful Patch is from the earlier genuine
[API capture](evaluation/api-acceptance.json), recorded at
`2026-10-05T17:54:39.141Z`. This replay is not a fresh live success and does not
alter the application's APIs or preload results for users.

The earlier real Patch used for visual QA was:

- Before: هذا الحديث يعني أن كل عمل لا يشعر صاحبه بالراحة النفسية هو عمل غير مقبول
- After: هذا الحديث يعني أن الأعمال بالنيات
- Source: `sahihayn-bukhari-1`.

It replaces the unsupported proposition while retaining its reporting frame.
Existing edit/source/quotation safety constraints remain in force.

See [recorded visual checks](ux-acceptance/recorded-visual-check.json). At 1600,
1440, 1280, 390 and 320 pixels:

- Both landing and expanded report retained RTL and had no horizontal overflow.
- Desktop claims/report widths were approximately 34%/66%; mobile stacked them.
- The input begins at about 520 px on desktop, within a 1080p screen.
- Source text, lineage and before/after diffs wrapped without truncating evidence.
- Keyboard Tab reached the visible skip link with a focus outline; Enter opened
  the full-source disclosure.
- Switching back restored each claim's independent verdict and Patch without
  another request. No browser runtime errors occurred in the final visual replay.
- Status uses icons and Arabic text as well as restrained colors. Inputs and
  controls have accessible names; headings and disclosures are semantic HTML.

Screenshots marked `replay-*` are the labeled replay. `blocked-flow.png` and
`transient-error.png` show actual live failures; they are not completed reports.

## Quality gate

`pnpm lint`, `pnpm typecheck` and `pnpm build` passed. The full network-independent
suite passed **404 tests in 31 files**, including 30 added anchor/API/report
regressions. Existing safety, immutable-source, malformed-result, stale-response
and sanitized-error assertions were retained.

## Exact source files changed in this refinement

```text
README.md
docs/DEMO_SCENARIOS.md
docs/UX_ACCEPTANCE.md
scripts/acceptance-browser.mjs
src/app/page.tsx
src/app/analysis/page.tsx
src/app/globals.css
src/app/api/analyze/evidence/route.ts
src/components/analysis-empty-states.tsx
src/components/analysis-flow.ts
src/components/analysis-results.tsx
src/components/claim-results.tsx
src/components/content-input.tsx
src/components/evidence-card.tsx
src/components/evidence-results.tsx
src/components/inline-alert.tsx
src/components/relation-analysis.tsx
src/components/site-header.tsx
src/components/workflow-stepper.tsx
src/components/yaqeen-patch.tsx
src/domain/claim-context.ts
src/evidence/resolve.ts
src/evidence/types.ts
tests/claim-context.test.ts
tests/evidence-api.test.ts
tests/evidence-ui.test.tsx
tests/patch-ui.test.tsx
tests/relation-ui.test.tsx
tests/report-ui.test.tsx
tests/sahihayn-pipeline.test.ts
tests/ui.test.tsx
```

QA artifacts are in `docs/ux-acceptance/`: `live-flow.json`,
`recorded-visual-check.json`, `layout.json`, five `landing-*` screenshots, the live
`claims-extracted`, `supported-quotation`, `transient-error` and `blocked-flow`
screenshots, and the `replay-*` report/source screenshots. Existing unrelated
working-tree changes were preserved.

## Reproduce locally

Use the existing server-side environment configuration. With pnpm installed:

```powershell
pnpm dev --hostname localhost --port 3100
```

With the cached runner used on this machine:

```powershell
npm.cmd exec --offline --package=pnpm@10.18.3 -- pnpm dev --hostname localhost --port 3100
```

Open `http://localhost:3100`. For the optional browser QA script, start the server
first and run `npm.cmd exec --yes --package=playwright@1.56.1 -- node
scripts/acceptance-browser.mjs`. The default run is live. `--layout-only` makes no
AI calls. `--recorded` explicitly replays the retained real captures for visual
regression and writes a separate artifact with `live: false`. No test fixture is
imported by the application.
