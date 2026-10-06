# Live evaluation: availability, semantics and end-to-end success

The version-1 labels still contain **all ten predeclared cases** in
[evaluation/cases.ts](../evaluation/cases.ts). No case or expected label was removed
or changed to improve a score. They cover exact quotations, paraphrase, unsupported
inference, overgeneralization, missing context, attribution, no evidence and
specialist referral. References and manual checks are recorded in
[SOURCE_PROVENANCE.md](SOURCE_PROVENANCE.md). Labels are provisional project-author
judgments, not expert-certified truth labels.

## Running it

```sh
pnpm eval:live
pnpm eval:live -- --delay-ms 20000
pnpm eval:live -- --key-cases --delay-ms 20000
pnpm eval:live -- --runs 3 --delay-ms 20000
```

Default: all ten cases, concurrency **1**, 2,000 ms between AI operations. The delay
is optional and configurable from 0 to 30,000 ms. The explicit smoke scope and
`--runs 3` use the same three established key cases: exact quote, comfort inference
and specialist referral. A smoke report is never presented as the ten-case suite.
Every run and every relation/Patch operation is awaited sequentially through one
queue, including after a failure. Known local reference snapshots are reused;
Patch reuses the existing validated relation rather than analyzing it again.

Successful-result caching is **bypassed for live evaluation**, including independent
three-run stability, so repeated labels are not manufactured by cache hits.
Application calls normally benefit from caching and in-flight deduplication.
Evaluation uses the same production retry policy, not a second retry loop: only
429/502/503/504, at most two retries, eight seconds total wait, within the 30-second
operation deadline. A longer Retry-After causes explicit failure instead of an
early retry. Source retrieval is fixed to the manually selected real Sahihayn
reference; no external retrieval, generated evidence or mocked AI response is used.
This measures reasoning/Patch, not extraction accuracy or retrieval recall.

The CLI emits only fixed error codes, HTTP status and attempt counts in developer
reports, not raw provider bodies, credentials or private environment values. Every
failed observation remains visible. Provider/setup/invalid-output failures produce
exit code 1; an available but wrong classification is recorded as a semantic miss.

## Methodology version 2

[evaluation/metrics.ts](../evaluation/metrics.ts) reports three separate groups.
All rates include numerator/denominator. No successful observations means **null /
not measured**, never zero semantic accuracy.

### A. Provider availability

An attempted AI observation is a case/run with at least one actual Groq HTTP
request. Retries increase `actualHttpAttempts`, not the observation denominator.
A successful observation has both validated relation and Patch results. Availability
is successful usable observations / attempted AI observations. HTTP/network/timeout
failures are counted separately from invalid structured-output failures and other
execution failures. A valid but incorrect classification remains an available
result. Deterministic no-evidence/referral cases do not inflate provider availability.

### B. Semantic performance on successful stages

| Metric | Denominator |
|---|---|
| Status classification | Valid relation results only |
| Mutation classification | Valid relation results only |
| Unsupported-inference detection | Valid relation results among labeled inference cases |
| Abstention | Completed labeled insufficiency/referral cases |
| Patch decision | Valid Patch results only |
| Evidence-reference validity | Valid relation results only |
| Paired baseline status | The same valid-relation subset as Yaqeen |

A valid relation remains scored if its later Patch call fails. A missing relation
or Patch never becomes a wrong semantic label. `aiReasoningOnly` separates actual
AI reasoning from deterministic safeguards, which otherwise count as system
behavior. A semantically wrong valid response does count as wrong. Reference
validity measures binding/traceability, not religious truth. Patch decisions measure
edit permission/action, not semantic edit quality; edit-script and quotation guards
provide structural safety, not scholarly certification.

### C. End-to-end system success

`completionRate`: both usable stages / **all** case/run observations.
`successRate`: completed observations whose status, mutation, Patch permission/action
and reference match the expected outcome / **all** observations.
Both can include provider failures in their denominator. These are explicitly
**end-to-end availability/success**, never model semantic accuracy. Setup failures
and deterministic observations remain listed too.

## Deterministic baseline

Evaluation-only rule: supplied matching evidence exists -> SUPPORTED; no evidence
-> NEEDS_CONTEXT. It never runs in application routes. Its full-label result is
**5/10 (50%)**. The comfort inference is an intentional counterexample: a real
hadith exists without establishing psychological comfort as an acceptance rule.
For a failed live run, `pairedBaselineStatusAccuracy` uses exactly the same valid
relation subset as Yaqeen; do not compare a subset model score against a whole-suite
baseline without explaining the different denominators.

## Corrected historical quota-limited report

[live-results.json](evaluation/live-results.json) retains the actual ten-case
observations from the prior quota-limited run. Only metrics were recomputed using
methodology version 2; **no new call, output replacement or relabeling occurred**.
The original report is retained in
[legacy-rate-limited-results.json](evaluation/legacy-rate-limited-results.json).

| Measurement | Corrected result |
|---|---|
| Attempted AI observations | 8 |
| Successful AI observations | 3 |
| Provider failures | 5 |
| Provider availability | 3/8 (37.5%) |
| Actual HTTP attempts, including retries | 20 |
| Valid-stage status / mutation accuracy | 5/5 (100%) each |
| AI-only status / mutation accuracy | 3/3 (100%) each |
| Abstention | 2/2 (deterministic cases) |
| Patch decision | 5/5 |
| Inference detection | Not measured: its provider call failed |
| Paired baseline status | 4/5 (80%) |
| End-to-end completion / expected-outcome success | 5/10 (50%) each |

The previous description of 5/10 as semantic accuracy was incorrect: it conflated
missing provider output with an incorrect classification. Five successes also do
not prove that the five unavailable cases would have been correct. Their failures
remain recorded, and the live gate still did not pass.

The earlier [error-free ten-case report](evaluation/pre-quote-guard-live-results.json)
matched 10/10 status and mutation labels against the 5/10 baseline; it predates the
extra bare-quotation guard and current reliability work. That small, selected run
is not a current full-suite rerun or a general-accuracy claim. Earlier initial,
transport-failed and pre-binding raw reports are retained as historical artifacts;
their legacy all-observation accuracy fields must not be used as successful-call
semantic accuracy when failures occurred.

## Stability and current smoke report

[stability-results.json](evaluation/stability-results.json) retains the previous
three-run observations with corrected metric groups; its original is
[legacy-stability-results.json](evaluation/legacy-stability-results.json).
Six actual-AI observations succeeded, with no provider failure; nine system
classifications matched (six AI and three deterministic referrals). Comfort Patch
was produced in all three runs, but wording identity is not claimed.

The conservative real request check after hardening is recorded separately in
[key-live-results.json](evaluation/key-live-results.json), with scope, timestamp,
model, delay, attempts, all outputs/errors and the three metric groups. It is only
a three-case smoke evaluation. Re-running `--runs 3` bypasses cache and performs
fresh sequential requests; unavailable runs cannot be counted as agreement.

After hardening, the actual three-case smoke run used a 20,000 ms gap. Exact quote
completed with SUPPORTED / DIRECT_QUOTE and no edit. Comfort inference received
HTTP 429 with a requested wait beyond the interactive retry budget, so no relation
or Patch was invented. Specialist referral completed deterministically.

| Current smoke measurement | Result |
|---|---|
| Attempted / successful AI observations | 2 / 1 |
| Provider failures / actual HTTP attempts | 1 / 2 |
| Provider availability | 1/2 (50%) |
| AI-only status / mutation accuracy | 1/1 (100%) each |
| Valid-stage system status / mutation accuracy | 2/2 each, including one deterministic referral |
| Abstention / Patch-decision accuracy | 1/1 / 2/2 |
| Unsupported-inference detection | Not measured: no valid result for that case |
| End-to-end completion / expected-outcome success | 2/3 (66.7%) each |

The command exited 1 for the visible provider failure. This is not a green live
gate, a new ten-case result, or evidence that the failed inference was classified
incorrectly. The previously recorded real comfort Patch remains an auditable
example; it was not regenerated in this quota-limited smoke run.

## Limitations

Small purposive sample; no blinded external annotation, inter-rater study or expert
certification; Arabic-only cases; fixed known-reference selection; ambiguous
missing-context boundaries; model-dependent wording; no comprehensive retrieval
recall or general religious accuracy claim. Production retry/cache reduces repeated
work but cannot bypass organization quotas or guarantee external availability.
