# Yaqeen | يقين

Yaqeen traces the relationship between an Islamic-content claim, its approved
source evidence, and the wording published by an author. A real quotation can
exist while the author's conclusion still exceeds its meaning. Yaqeen makes that
boundary visible and proposes **تصحيح يقين | Yaqeen Patch**, the smallest safe
correction supported by the supplied evidence.

This is an Arabic-first RTL competition product, not a chatbot or a personal fatwa
service. The AI is an analytical tool, **never a religious evidence source**.

## Implemented

- Arabic/English structured claim extraction through server-only Groq.
- Arabic local Sahihayn lexical retrieval: 7,277 Bukhari + 7,368 Muslim records.
- Live Quran/tafsir retrieval through Quranpedia, within documented limits.
- Official Dorar as optional live retrieval beyond a local miss; outages disclosed.
- Official HadeethEnc approved explanation lookup, with conservative matn matching,
  exact source provenance and restricted reasoning when no explanation is available.
- Independent Claim ↔ Evidence reasoning, traceable evidence IDs and Arabic labels.
- Evidence-preserving Patch with strict output, an exact edit script, authenticated
  local source binding, before/after display, abstention and specialist referral.
- Text-only submission UI; unfinished image functionality is hidden.
- Ten labeled live evaluation cases, presence-only baseline and three key-case
  repeated runs. Actual scores are in [EVALUATION.md](docs/EVALUATION.md) and artifacts.
- Safe readiness endpoint, request limits, automated safety/UI/API tests and
  production file tracing for Vercel.

## Problem and differentiation

Finding a source is not the same as demonstrating that a claim follows from it.
A writer may quote a real hadith, omit a qualification or draw an unsupported
conclusion. Yaqeen separates the quotation from interpretation, shows what the
supplied evidence actually establishes, identifies the excess, and proposes an
explicit minimal edit instead of silently rewriting religious content.

## Architecture and AI use

```text
Text → structured claims → selected claim
                          ↓
            Approved evidence retrieval
            ├─ Arabic hadith → local Sahihayn first
            │                  └─ optional Dorar after a miss
            └─ Quran/tafsir → bounded Quranpedia API
            Hadith → official HadeethEnc explanation (optional, source-bound)
                          ↓
            Claim ↔ supplied evidence analysis
                          ↓
            Meaning excess / missing qualification
                          ↓
            Yaqeen Patch / no safe patch / specialist referral
```

One Next.js App Router application, TypeScript, React, Tailwind CSS, pnpm and Zod.
All provider calls execute on the server. Groq `openai/gpt-oss-120b` uses strict
JSON Schema output, validated again with Zod and evidence/text bindings. Gemini
remains available for extraction but inactive in the competition configuration.
Reasoning and Patch use Groq. There are no microservices, embeddings, broad web
search or generated source passages. PostgreSQL/pgvector scaffolding remains
optional and is **not used by the core demo**.

## Claim extraction

`POST /api/analyze/claims` with `{"text":"..."}` returns `{"claims":[...]}`.
It splits independently checkable statements, separates religious quotations from
an author's interpretation, preserves original wording and gives normalized search
wording separately. It supports Arabic and English, removes duplicate claims,
and returns an empty array for purely subjective input. Extraction is not a verdict.
Input is limited to 10–10,000 characters and a bounded JSON body.

## Approved evidence retrieval and provenance

`POST /api/analyze/evidence` accepts `{"claim":<complete extracted claim>}` and
returns `{"evidence":[...],"retrieval":{...}}` when source status is relevant.
Evidence includes immutable exact text, collection/source name, available reference,
canonical URL, source type and honest metadata. Relevance is lexical matching,
**not confidence in truth**. The UI preserves the religious reference as
**صحيح البخاري / صحيح مسلم**, not the machine-readable dataset host.

The local files are a read-only **search-index representation**, imported from
[meeAtif/hadith_datasets](https://huggingface.co/datasets/meeAtif/hadith_datasets)
at revision `cd62605e4fef3c46968a5f9fdcccbbbffdf631b5`. Arabic is imported exactly;
matching alone removes tashkeel, normalizes common letter forms and whitespace.
Ranking: exact normalized phrase, phrase containment, strong token overlap, weaker
lexical similarity; at most five candidates. Supplied numbering variants/ranges
are preserved. Runtime checks file hashes and schemas; no downloads or writes.

The card credits Atif (@meeAtif) and declares MIT, but establishes no audited
edition or complete upstream permissions chain. Grade fields are absent/blank;
Yaqeen invents no narrator, grade, scholar or edition. Counts are records including
variants, not unique statements or proof that every edition is complete. Read
[SOURCE_PROVENANCE.md](docs/SOURCE_PROVENANCE.md) and the
[index attribution/manifest documentation](data/hadith/README.md).

Local hits return with `LOCAL_PRIMARY`, without Dorar calls. Optional HadeethEnc
explanation enrichment is separately bounded and never removes primary evidence.
On a miss, enabled [official Dorar](https://dorar.net/article/389) search may
return `DORAR_CROSSCHECK` results; that role denotes optional retrieval, not a
fabricated validation badge. Cloudflare 403/timeouts are known. A local miss plus
optional-source failure returns an honest current-scope result and availability
status. `DORAR_ENABLED=false` removes this dependency entirely for the three demos.
No background cross-check is claimed when it was not performed.

[Quranpedia](https://quranpedia.net/api-docs) is server-only: explicit numeric
surah/ayah references, bounded Arabic topic-linked verse search, and tafsir book 1
for explicitly cited interpretations. Original Quran/tafsir text is never rewritten.
It is not complete semantic Quran search. See source adapters and provenance docs.

## Evidence reasoning

### Bounded AI grounding payload

The UI and per-claim session retain **all** retrieved evidence and complete approved
explanations. The AI transport has a separate minimal envelope: only the strongest
candidate under existing retrieval ordering (stable ties), its exact religious text,
minimal reference/collection identity, and its linked HadeethEnc explanation. Patch
uses the evidence ID already selected by the independent relation analysis.

Explanations up to 3,200 characters are supplied in full, once. Longer explanations
are split deterministically at sentence/paragraph boundaries, ranked by lexical
overlap with the claim, supplied hadith and any identified excess, and limited to
2–4 original spans/3,200 characters. Each span retains original offsets and exact
wording plus source ID/reference. Explicit related qualifications must be retained;
if they cannot fit, analysis abstains. This is selection, never an AI summary. Hints,
duplicate hadith/claim fields, URLs and raw/display metadata are excluded from the
AI envelope; complete source records remain available in the UI/session.

Original context is bounded to 1,200 characters using validated claim offsets (or
a unique exact occurrence). An immediately preceding matching quotation and its
explicit discourse connector are retained separately when existing anchor rules
accept them. An anchor identifies evidence, never inherits another claim's verdict.

Before sending, the **complete serialized UTF-8 Groq request**, including prompts,
JSON escaping, model/transport fields and strict schema, must fit **18,000 bytes**.
Optional surrounding prose is removed first. Required claim/source/explanation and
anchor spans are never silently truncated. If they cannot fit safely, relation
returns `NEEDS_CONTEXT / NONE`, and Patch returns `NO_SAFE_PATCH`, without a Groq
call. The model/provider and output-token setting are unchanged. This application
budget is conservative; it is not a token counter or a guarantee of provider quota
availability. Development diagnostics contain counts/validation booleans only,
never keys, headers or submitted/source text. Production diagnostics stay silent.

See [payload measurements and live HTTP validation](docs/payload/README.md).

### Approved hadith explanation

The official [HadeethEnc developer documentation](https://documenter.getpostman.com/view/5211979/TVev3j7q)
currently documents Arabic keyword search (`hadeeths/search/?language=ar&phrase=...`)
and detail lookup (`hadeeths/one/?language=ar&id=...`). Real responses were checked on
2026-10-06. There is no local HadeethEnc index, ID mapping or explanation generated
by an LLM. The official Excel download is unnecessary while documented search works.

`src/evidence/explanations/` matches the actual retrieved hadith, not the claim's
topic: exact normalized matn first, distinctive contiguous phrases next, and only
long, near-identical lexical overlap last. Ambiguous candidates abstain. A tie can
be resolved only by a substantially longer exact contiguous matn passage. Arabic
normalization is for comparison; original hadith and explanation strings stay exact.

Evidence responses optionally add `explanations` and `explanationStatus`. Each
explanation retains `evidenceId`, official `sourceId`, exact explanation/hadith,
reference, attribution, grade, hints, source name, match method and actual `apiUrl`.
The observed API provides no public record URL; `sourceUrl` is null and the UI does
not manufacture a public link. Reported source grading is not a claim verdict.

Reasoning and Patch accept optional `approvedExplanations`. The server resolves
them authoritatively again through the shared source cache instead of trusting
browser-supplied approval text. Both existing Groq calls receive exact source
explanations directly: **no extra AI explanation or summarization call**. AI cache
keys bind the complete approved-source input alongside exact evidence and model.

Without a defensibly matched explanation, exact-quote/explicit-text comparison
remains available. Hadith `INTERPRETATION` and `RULING` claims return deterministic
`NEEDS_CONTEXT / NONE`: «لم يتوفر شرح معتمد كافٍ لتقييم هذا التفسير بثقة.» Other
claims use a prompt restricted to explicit wording, attribution and defensible
lexical comparison. Patch abstains for interpretation-heavy hadith corrections
without approved explanation. Unsupported-inference corrections qualify the
evidential inference or retain exact supplied meaning; they cannot invent the
opposite theological proposition. These checks do not certify semantic correctness.

Lookup has a three-second total search/detail deadline, deduplicated in-flight
requests and two process-local caches, each capped at 200 entries/four MiB with a
256 KiB entry cap. Successful source responses/explanations live for ten minutes;
no-match results for one minute; failures are not cached. No explanation outage
turns a successful primary retrieval into HTTP 502. Coverage is intentionally
incomplete and ambiguous narration variants may be rejected.

The evidence card separates **النص الشرعي**, expandable **الشرح المعتمد**, and
**تحليل يقين**. Source attribution is **موسوعة الأحاديث النبوية – HadeethEnc**.
Only the strongest evidence is expanded; **أدلة مرتبطة أخرى (N)** expands locally.
Hadith cards keep copy/Dorar search actions; duplicated Patch reference UI is
removed while IDs/provenance remain internal. Approved source data participate in
per-claim memory and validated sessionStorage restoration, with zero calls for
ordinary navigation, claim switching or refresh. Explicit evidence re-analysis
invalidates the explanation and downstream results together.

Re-run the small, source-only live check (no Groq calls):

```sh
pnpm source:validate
```

Results are in [live-source-validation.json](docs/hadeethenc/live-source-validation.json).
The actual checks resolved Bukhari 1 → 66511 and Bukhari 71 → 5518. Muslim 223
returned `NO_APPROVED_EXPLANATION` because records 65004/66526 were equally strong;
its local hadith remains available. Captured official JSON fixtures make unit tests
network-independent. See [source provenance](docs/SOURCE_PROVENANCE.md) for the
observed fields, terms, retrieval limits and update procedure.

A single [real Bukhari 71 reasoning/Patch check](docs/hadeethenc/live-bukhari-71.json)
returned `SUPPORTED / DIRECT_QUOTE` for the quotation and independently
`UNSUPPORTED / UNSUPPORTED_INFERENCE` for the conclusion. The first Patch call
was unavailable; a later Patch-only retry reused the saved reasoning and succeeded.
The artifact retains that failure. No broad Groq evaluation was run. Previous
evaluation reports predate this explanation layer and are historical measurements,
not new scores for the current implementation.

`POST /api/analyze/relation` accepts:

```json
{"claim": "<complete extracted claim object>", "evidence": ["<complete candidate object>"], "originalContent": "optional surrounding content"}
```

The example uses object placeholders, not literal API values. The response is
`{"analysis":{verificationStatus,relationType,strongestEvidenceId,supportedMeaning,
unsupportedPart,missingContext,reasoning,requiresSpecialist}}`.

Each claim is reasoned over separately using **only supplied passages and approved
source explanations**. Surrounding
content establishes what the author wrote, not religious proof. An identified
reporting author is distinct from a claimed original source. The model detects
faithful quotation/paraphrase, removed context, overgeneralization, unsupported
inference, misattribution and translation drift. All UI labels are Arabic; raw
status enums remain API vocabulary only. There are no numeric confidence scores.
Empty evidence yields deterministic `NEEDS_CONTEXT / NONE`. Personal applications
have a narrow first-person referral boundary before model invocation; no personal
ruling is issued. When an
interpretation explicitly refers to “this hadith” and surrounding content has one
quotation matching one supplied passage, that evidence ID is bound for traceability.
This identifies the passage being interpreted; it never makes the inference supported.
Output bindings and
source snapshots are checked, but model judgment can still be wrong.

In the UI, select a claim card and choose **البحث عن الأدلة**, then **تحليل العلاقة**.
The evidence endpoint accepts an optional `context` containing the actual extracted
claims and original content. `src/domain/claim-context.ts` resolves only explicit
Arabic references such as “هذا الحديث يعني” or “هذه الآية تدل”, and discourse
connectors such as “ثم استنتج أن”, “ثم ذكر أن”, “وبناءً على ذلك” and “لذلك”
linking an interpretation to the immediately preceding quotation/religious statement.
Validated `originalStart` / `originalEnd` locate the claim in the full original text;
the bridge may be outside its extracted wording. Without offsets, only a unique
exact occurrence is accepted. It checks real IDs, exact input spans,
chronology and source-type compatibility; ambiguous or unrelated references abstain.
Submitted anchor IDs are checked against that deterministic link.

`src/evidence/resolve.ts` tries direct retrieval first. When it finds no evidence,
an explicit anchor may resolve the prior claim's approved evidence. The response
adds `resolution: {evidenceOrigin: "DIRECT" | "CONTEXTUAL_ANCHOR",
evidenceAnchorClaimId: string | null}` outside the immutable evidence objects.
The UI labels this **الدليل المشار إليه في السياق**. Each interpretation gets a
new independent reasoning request: evidence context never copies a verdict.
No thematic matching, extra model call, source provider or extraction-schema
change is introduced. Requests without `context` keep the existing API behavior.

The report uses a five-stage navigation stepper, a claims sidebar and one selected
stage pane. Completed stages are clickable; unavailable stages are disabled, and
the selected stage is active. Navigation and claim switching reuse stored results
without retrieval or AI calls. Leaving a pending stage cancels its response.

The root application provider owns the extracted claims, original text, each
claim's evidence/provenance, independent reasoning, Patch and selected stage.
Meaning drift is derived from the saved reasoning fields, with no second AI call
or duplicate result that could become stale. A versioned, bounded snapshot is
saved to browser **sessionStorage**, never localStorage. Refresh and route navigation
restore the same session after schema and claim/evidence binding checks. This is
temporary browser-session storage, not a permanent server report. Corrupt or
inconsistent snapshots are discarded; blocked/quota-limited storage leaves memory
usable, but refresh restoration is unavailable in that case.

Starting a new extraction clears the previous session before calling the API.
Explicit re-analysis clears only that claim's requested stage and its dependents:
evidence clears reasoning/drift/Patch; reasoning clears drift/Patch; Patch clears
only Patch. The re-analysis controls then make the requested call. Ordinary stage
navigation never invalidates a result or calls an API.

When relation analysis cannot identify sufficient evidence, the stepper ends at
**تعذر الاستكمال** after claims, evidence and relation; it does not activate Patch
while meaning analysis is unavailable, and no correction action is offered.
Long hadith passages show an exact source excerpt with full immutable text in an accessible
disclosure. Technical errors retry only the failed stage and preserve prior work;
valid `NO_SAFE_PATCH`/`REFER_SPECIALIST` decisions are terminal, without retry.

Every hadith evidence card has accessible icon actions **نسخ نص الحديث** and
**البحث في الدرر السنية**. Copy preserves the exact displayed evidence excerpt
(or full displayed text when no excerpt is used) and briefly shows **تم النسخ**.
The Dorar action opens `https://dorar.net/site/search?q=...` in a new tab. Its
deterministic query prefers a source-matched claim quotation, then a matched Arabic
matn excerpt, with bounded word-aligned spans for long passages. This is a manual
search, not automatic Dorar verification or an individual hadith citation. It
makes no server request and does not affect evidence retrieval or analysis.

## Yaqeen Patch

`POST /api/analyze/patch` accepts the same claim, evidence, optional originalContent
and the existing `analysis` object. It returns `{"patch":{...}}` containing:
`action`, `originalText`, nullable `proposedText`, `changes` (original/replacement
segments, mutation and reason), `preservedIntent`, `evidenceIds`, and `explanation`.

Actions are `PATCH`, `NO_SAFE_PATCH`, or `REFER_SPECIALIST`. The original text must
match exactly; every edit must be a unique, nonoverlapping original segment; the
proposed text must reconstruct from only those edits; changes use the identified
mutation and cite supplied evidence IDs. Religious quotations are protected;
changed/new marked quotations must use exact supplied wording. An edited unmarked
`QUOTE` claim must also match a verbatim span in cited evidence or Patch abstains.
No correction is forced for already supported claims. Missing evidence and specialist cases
abstain/referral deterministically, without a model call.

**Current correction scope is deliberately narrow:** Patch authenticates exact
local Sahihayn evidence against the checksum-checked bundled records, discarding
caller-invented metadata. It abstains for Quranpedia/Dorar-only or mixed snapshots
rather than pretending their provenance has been authenticated for correction.
It reasons only from those authenticated passages, never adds a religious source,
and proposes an edit for review; it does not publish or modify the original input.
Structural checks are not certification of semantic correctness. Qualified review
is required before publishing a religious correction.

## Groq reliability

Extraction, reasoning and Patch share one server-side transport. It retries only
HTTP 429/502/503/504, at most twice after the original request, with an eight-second
aggregate wait budget inside the existing 30-second operation deadline. Retry-After
seconds/dates are respected; if the requested delay exceeds the remaining budget,
the call fails safely instead of retrying early. Without that header, short
exponential backoff includes jitter. Authentication, permission, other 4xx,
schema/validation and network errors are not retried. Development diagnostics show
only status/attempt/wait, never provider bodies, credentials or input.

Fully validated Groq service results share a process-local ten-minute LRU cache:
100 entries, four MiB total, 256 KiB per entry and 32 in-flight operations. Hash keys
bind operation/model, canonical normalized input and an exact input/evidence
fingerprint. Exact wording/offsets/source changes cannot reuse a mismatched result.
Identical concurrent requests share work; every caller receives an independent
copy. Cancelling one caller preserves other subscribers, and abandoned work is
aborted. Failures and malformed/unbound outputs are never cached. Keys contain no
API credential, and outputs containing a configured credential are excluded from
storage. Existing API response headers remain `no-store`.
This cache disappears on process restart and is not shared across Vercel instances.

The current comfort-inference Patch replaces only the unsupported proposition with
«الأعمال بالنيات», preserving «هذا الحديث يعني أن». Merely weakening the invented
comfort/acceptance condition would still assert something the passage does not
establish. This is a minimum evidence-preserving correction of that proposition,
not a claim of globally shortest wording or a new religious acceptance rule.

## Safety and abstention

- Prefer «لا تتوفر أدلة كافية ضمن المصادر المتاحة» to guessing.
- No generated source text, invented citation/grade/narrator or universal truth score.
- Original evidence text/metadata remain separate from AI explanations and edits.
- Provider failure is an error with no fake result; missing evidence is abstention.
- The UI escapes source strings; tafsir markup uses safe plain-text display.
- API bodies, text lengths, source responses, concurrency and execution are bounded.
- Paid AI routes share a 15-starts/minute, three-concurrent per-process budget;
  retrieval has its own 30-starts/minute, three-concurrent budget. These are not
  distributed/user-specific quotas. Enable Vercel edge abuse controls for public traffic.
- Reasoning/Patch AI deadline is 30 seconds; routes allow 40 seconds. Primary retrieval
  is bounded to 12 seconds; explanation enrichment has a separate three-second cap.
  Production returns fixed error codes, never provider bodies.
- Caller-provided reasoning evidence is shape/host validated, not independently
  re-fetched; use application retrieval results. Patch performs stronger local
  authentication. A public API is not a scholarly authentication service.

## Evaluation and reproducibility

Ten predeclared cases with exact approved references cover quotation, paraphrase,
unsupported inference, overgeneralization, missing context, attribution, insufficient
evidence and specialist referral. Labels were manually documented by the project
owner, not externally expert-certified. Fixed evidence isolates reasoning/Patch;
full extraction/retrieval is checked separately by API acceptance.

```sh
pnpm eval:live
pnpm eval:live -- --runs 3
```

The second command uses only three key cases to limit API use. Both make real
Groq calls and write safe public-case JSON reports under `docs/evaluation/`.
Metrics separate provider availability, semantic accuracy on valid outputs, and
end-to-end completion/success. Failed provider calls stay visible and never become
wrong semantic labels. Independent runs bypass the successful-result cache.
The default suite retains all ten cases. Use `pnpm eval:live -- --key-cases
--delay-ms 20000` for a conservatively paced three-case smoke check, or
`pnpm eval:live -- --runs 3 --delay-ms 20000` for sequential independent key-case
stability. The deterministic
presence-only baseline is evaluation-only. See [method, scores and limitations](docs/EVALUATION.md).

## Prerequisites and installation

Node.js **22.13+** and pnpm **10.18.3**; a Groq account/key for AI actions.
No Docker, PostgreSQL, Gemini key or Dorar connectivity is needed for the local
Sahihayn demo. Install dependencies and copy the example environment:

```sh
corepack enable
corepack prepare pnpm@10.18.3 --activate
pnpm install --frozen-lockfile
cp .env.example .env.local
```

PowerShell alternative for the last command: `Copy-Item .env.example .env.local`.
Set the local key in `.env.local`; never commit it.

## Environment variables

| Variable | Required for core demo | Value / purpose |
|---|---|---|
| `GROQ_API_KEY` | Yes, for AI calls | Private Groq account key; server-side only |
| `AI_PROVIDER` | Defaults to Groq | `groq` for competition extraction |
| `GROQ_TEXT_MODEL` | Defaults to pinned model | `openai/gpt-oss-120b` |
| `DORAR_ENABLED` | No | `false` for reproducible local demos; `true` for optional wider search |
| `GEMINI_API_KEY` | No | Inactive extraction adapter, only used if explicitly selected |
| `APP_URL` | No runtime dependency | Optional deployment URL; default localhost is a development setting, never a provider target |
| `DATABASE_URL`, `DB_POOL_MAX` | No | Only optional database scripts/future persistence |

The app can start without a key; AI invocation returns `503 AI_NOT_CONFIGURED` and
health reports degraded. Optional inactive keys are not validated at startup.

## Local development, checks and production

```sh
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

Open http://localhost:3000. Results live in application memory and temporary browser
sessionStorage; refresh restores the session when browser storage is available.
`GET /api/health` validates Groq configuration and bundled corpus integrity, returning
only ready/degraded booleans, with no external probe, key, path or exception details.
It does not promise provider availability.

Tests are network-independent and include adversarial input, exact evidence,
Dorar outages, provider failures, binding/immutable-source safety, referral and UI
stale-result handling. Live evaluation is a separate opt-in network/cost command.

## Vercel deployment

Import the repository as a Next.js project. Use Node 22+ and the pinned pnpm version,
install `pnpm install --frozen-lockfile`, build `pnpm build`; no custom start command
or database service is required. Set server environment variables above for Preview
and Production; `DORAR_ENABLED=false` gives reliable local-demo retrieval. Redeploy
when configuration changes. No `NEXT_PUBLIC_*` AI key is used.

`next.config.ts` explicitly traces both read-only corpus files into evidence,
Patch and health Node functions. There are no application runtime filesystem writes
or localhost service dependencies. Keep data/manifest files and documentation in
version control. Verify `/api/health` and scenario 1 after deployment; configuration
readiness is not a live API probe. Deployment has been **prepared, not published**.

See [Next.js deployment](https://nextjs.org/docs/app/getting-started/deploying) and
[Vercel function limits](https://vercel.com/docs/functions/limitations). Check the
selected plan's function limits, network egress and bundle size. Rate limits here
are per-process; public abuse protection/quotas are platform deployment settings.
Local production success does not substitute for the hosted smoke test.

## Optional database scaffolding

The schema/migration tooling for PostgreSQL + pgvector remains separate from the
core demo and is not invoked by its API routes. If intentionally using it, configure
`DATABASE_URL`, start the provided local database, then run `pnpm db:migrate` and
`pnpm db:check`. No claims, evaluations or sources are persisted by the submission
flow. No database migration was required for reasoning/Patch.

## Project structure

```text
src/app/                 RTL pages and api/analyze/{claims,evidence,relation,patch}, api/health
src/components/          Input, selected evidence, relation trace, Patch comparison
src/domain/              Extraction, relation and Patch Zod contracts; stable vocabulary
src/ai/                  Services/prompts and server-only Groq/Gemini providers
src/evidence/            Source router, deterministic matching, approved adapters
src/sources/             Approved source registry and scope documentation
src/lib/                 Environment, bounded IO, optional database tooling
 data/hadith/            Bundled Sahihayn index, integrity manifest and attribution
 evaluation/             Versioned labeled cases, metrics and evaluation-only baseline
 scripts/                Live evaluation, pinned import and optional DB checks
 tests/                  Network-independent unit/API/UI safety tests
 docs/                   Provenance, evaluation/results, demos, judging and acceptance
```

## Demo and judging material

Exactly three reproducible [demo scenarios](docs/DEMO_SCENARIOS.md): the intentions
quotation plus comfort inference, Bukhari 71, and Muslim 223. Each records input,
expected claims/reference/relation/Patch, selected-reference checks and limitations.
See [judging evidence mapping](docs/JUDGING_ALIGNMENT.md) and
[actual acceptance results](docs/ACCEPTANCE.md).

The latest [UX and contextual-linking acceptance](docs/UX_ACCEPTANCE.md) records
the real two-claim browser results, provider availability failures, and separately
labeled responsive/keyboard replay checks. It includes the exact changed-file
inventory and local commands; recorded UI QA is not presented as a new live Patch.

## Current limitations and future work

Implemented scope: Arabic lexical hadith search of the indexed Sahihayn only;
Arabic/English extraction; bounded live Quran/tafsir retrieval; model-dependent
snapshot reasoning; Patch only for authenticated local evidence. Search may miss
alternate wording, context or relevant wider evidence. Some attribution/context
boundaries are ambiguous; personal religious rulings always require a specialist.
The corpus is not an audited edition. Scores apply only to the selected evaluation.

Future work, **not implemented**: authenticated Quran/tafsir/Dorar Patch, specialist
editorial review workflow, semantic/vector retrieval, wider approved collections,
persistence, distributed quotas and extraction benchmarking. No image, video,
audio, chatbot, account/dashboard, MCP, fine-tuning or social feature is advertised.

External dependencies: Groq availability/quotas for AI; Quranpedia for live Quran/
tafsir; optional Dorar for wider hadith; selected plan/platform for hosting. The
bundled hadith retrieval itself needs no network. Failed providers never yield
synthetic religious results.

## Security, secrets and licenses

`.env*` is ignored except `.env.example`; no real credential belongs in source,
logs, URLs, error bodies, evaluation artifacts or browser bundles. Provider modules
are marked `server-only`. Submitted content/evidence reach Groq only on explicit
AI actions and optional search phrases reach approved live sources when needed.
The app does not persist them, log them, or use browser storage/analytics. Review
provider data-handling terms and avoid sensitive submissions. Rotate accidentally
exposed credentials; do not print them to diagnose configuration.

All religious evidence attribution remains with the original collection/reference.
Preserve the index's dataset attribution and declared-license/provenance caveats
in [SOURCE_PROVENANCE.md](docs/SOURCE_PROVENANCE.md) and [data/hadith/README.md](data/hadith/README.md).
Upstream edition/permissions certification is not claimed. Dependency licenses
remain those of their authors; this private competition project declares no new
license over religious source material. Official adapters follow approved API
scope, not broad scraping. The LLM is never itself a religious source.
