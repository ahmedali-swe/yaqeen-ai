# Bounded reasoning request validation

The original public Bukhari 71 example was measured **before** compaction. The real
Groq request returned **413**, with a reported token limit of **8,000** and a request
estimate of **8,463**. [baseline.json](baseline.json) records 34,650 serialized UTF-8
bytes, five candidates, 9,576 prompt characters, 2,499 evidence characters, 1,780
explanation characters and 1,330 hint characters. Repeated narration variants,
complete explanation records, duplicated claims and display/raw provenance added
unnecessary tokens. No provider body, organization identity or credential is stored.

Groq documents [413](https://console.groq.com/docs/errors) as an oversized request;
the actual numeric rejection here identifies the input token limit, rather than a
known universal byte ceiling. The application now budgets the full serialized body
at 18,000 bytes, never just `JSON.stringify(input).length`.

`src/ai/grounding-payload.ts` selects one candidate without changing the adapter's
tie ordering. It produces immutable-source copies of minimal identity/text and
deterministically ranked exact explanation spans. Related explicit limitations are
mandatory; grounding that cannot fit is rejected safely, not paraphrased/truncated.
`src/ai/groq-request.ts` includes strict schema, prompt, escaping and transport fields
in the budget, dropping only optional surrounding prose before abstention.

The original content/claims and **all** full evidence/explanation/hint records remain
in the source/UI/session contracts. No extra AI call is made to summarize sources.
No model, provider, API domain contract or religious-text editing rule was changed.

To repeat one conservative live HTTP check against a running local app:

```sh
node --conditions=react-server --import tsx scripts/validate-grounding-payload.ts http://127.0.0.1:3107
```

The validator uses actual endpoints, strict schemas, sequential calls, 20-second
spacing before reasoning/Patch, and fail-fast behavior. It records the exact shared
request builder measurements and preserves earlier HTTP failures in `previousAttempts`.
[live-bukhari-71.json](live-bukhari-71.json) contains the normal ranking flow.
[live-bukhari-71-reference.json](live-bukhari-71-reference.json) separately records
the targeted reference-71 checks, selecting it from actual retrieved candidates.
Earlier experiments exposed a tie-order bug in the first compact selector and
rejected Patch edit scripts. The selector was corrected to preserve adapter order,
and the compact Patch instruction explicitly derives proposed text from its edits;
existing validation remains strict. Neither successful nor failed calls are claimed
as a broad semantic evaluation.

Regression coverage includes strongest-only input, source/store/UI preservation,
verbatim deterministic spans, complete-sentence and qualifying-context preservation,
bounded validated original context, no hints, complete request budgets, safe abstention,
contextual provenance/verdict independence, Patch bounds and development-only diagnostics.

Final normal HTTP check: claims/evidence/relation/Patch all returned **200**. The
strongest source was **Bukhari 71**, contextual provenance was `CONTEXTUAL_ANCHOR`,
and the official explanation was **HadeethEnc 5518**. The quote was
`SUPPORTED / DIRECT_QUOTE`; its independently evaluated conclusion was
`UNSUPPORTED / UNSUPPORTED_INFERENCE`. Serialized relation requests were **7,949
bytes** (quote) and **8,182 bytes** (conclusion), versus the original **34,650 bytes**.
Patch was **8,342 bytes** and returned an accepted minimum correction: replacing
only `كل` with `لا يكفي هذا الحديث للاستدلال على أن كل`, preserving every remaining
character. Five full source candidates remained in the retrieval/session result;
only one candidate and its complete short approved explanation entered the model.

Final regression suite: **518 tests, 39 files**, including 19 added cases. Lint,
typecheck and the production build passed. These observations are one real public example, not an accuracy
claim or a guarantee against provider rate limits. Earlier failures remain visible.
