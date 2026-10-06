# Source boundary and provenance

## Approved HadeethEnc Arabic explanations (checked 2026-10-06)

**موسوعة الأحاديث النبوية – HadeethEnc** supplies approved explanation/reference
material, never LLM-generated evidence. The [official homepage](https://hadeethenc.com/en/home)
links its Developers API, Arabic Excel download and reuse terms. The developer
link currently redirects to the [official published API documentation](https://documenter.getpostman.com/view/5211979/TVev3j7q).
No religious HTML page scraping or private endpoint is used.

Real Arabic HTTP 200 responses confirmed these documented endpoints under
`https://hadeethenc.com/api/v1`:

| Endpoint | Actual JSON shape |
|---|---|
| `hadeeths/search/?language=ar&phrase=...` | Array of `{id:string,title:string,hadith_text:string,hadith_text_highlights:string}`; highlights are ignored |
| `hadeeths/one/?language=ar&id=...` | Object with `id`, `title`, `hadeeth`, `attribution`, `grade`, `explanation`, `reference`, `hadeeth_intro` strings; `hints`, `categories`, `translations` arrays; `words_meanings` empty in the observed records |
| `hadeeths/list/?language=ar&category_id=1&page=1&per_page=2` | `{data:[{id,title,translations}],meta:{current_page:string,last_page:number,total_items:number,per_page:string}}` |

Languages/categories and multiple-record lookup are also documented. This adapter
uses only public search and Arabic detail. Search is broad keyword discovery;
its first result is never trusted by rank alone. **Live documented search was
chosen; zero HadeethEnc records are locally indexed.** The official Arabic Excel
download was confirmed as `HadeethEnc.com_ar-v1.7.0.xlsx`, but is not bundled or
used as fallback. Its version does not identify the live API edition, which is unknown.

Matching uses immutable retrieved matn, with a query hint only when present in
that source text. Normalization removes tashkeel and normalizes alif, punctuation
and whitespace solely for comparison. Accepted matches: exact normalized matn;
distinctive contiguous phrases (three words, 15 characters, two non-generic
keywords minimum); long near-identical lexical agreement (eight shared distinctive
terms, 95% overlap both ways, 12 words each). Equal-ranked records abstain unless
one matches at least 12 exact contiguous source words and exceeds the next by
both four words and 50%. Topic/collection/generic overlap alone cannot select
a record. Detail ID and matn are checked again. No LLM selects an explanation.

| Real source-only validation | Result | Supplied metadata |
|---|---|---|
| Bukhari 1 | `66511`, `PHRASE_CONTAINMENT` | Explanation, reference and grade available; longer exact source agreement than `4560` |
| Bukhari 71 | `5518`, `EXACT_TEXT` | Explanation, reference and grade available |
| Muslim 223 | `NO_APPROVED_EXPLANATION` | `65004`/`66526` equally strong; neither silently chosen |

[Live observations](hadeethenc/live-source-validation.json) retain exact approved
text and request provenance. [Fixture provenance](../tests/fixtures/hadeethenc-provenance.json)
records real official capture URLs/hashes. Positive fixture transports isolate
unit tests from the network; full captured search tests verify actual ambiguity.
Production has no demo-ID mapping. Revalidate with `pnpm source:validate`, using
no Groq quota.

Retained fields: exact hadith/explanation, title, attribution, reported grade,
reference and hints. Unused introduction/translation/highlights are excluded from
reasoning. The binding is `evidenceId → HADEETHENC → sourceId → apiUrl`. The API
supplies no reliable public record URL: `sourceUrl:null`, no manufactured browse
link. Strings are not trimmed or rewritten. The UI credits **موسوعة الأحاديث
النبوية – HadeethEnc**, marks a partial exact excerpt, and locally expands the
complete original explanation. Yaqeen's supported-meaning field is separately
labelled analysis grounded in evidence/explanation, never original source wording.

Official reuse terms permit download/republication while preserving original
content and clear HadeethEnc attribution; translations must retain version and
transcript information. No permission to modify religious explanations is asserted.
This layer uses read-only API search and a short cache. If a local index is needed
later, import only the official download, record version/date/fields, preserve
originals, credit HadeethEnc, and update retained data when the source changes.
API cache refreshes after ten minutes. Fixtures are historical captures, never
a production explanation fallback.

A three-second total source deadline, bounded cache and unavailable state keep
primary evidence functional. Interpretation-heavy hadith analysis without an
approved explanation returns `NEEDS_CONTEXT / NONE`; quote comparison remains
available. Patch uses the explanation in its existing call, qualifying unsupported
inference rather than asserting its theological opposite. Browser-provided approval
text is re-resolved on the server. Per-claim memory/sessionStorage reuses explanations
without navigation requests and never stores permanent reports.

Yaqeen compares claims with supplied approved evidence. The model is an analytical
tool, never a religious evidence source. A retrieved passage does not automatically
support the author's conclusion. All classifications are scoped to that snapshot.

## Approved architecture

| Route | Religious reference | Retrieval representation | Availability |
|---|---|---|---|
| Hadith, primary | صحيح البخاري / صحيح مسلم and available reference identifiers | Read-only local Sahihayn JSON index | Bundled; no live provider required |
| Hadith, optional | The collection/reference and metadata actually returned by Dorar | [Official Dorar API](https://dorar.net/article/389) | Optional after a local miss; may return Cloudflare 403 |
| Quran / tafsir | Quran surah/ayah and named tafsir/reference actually returned | [Quranpedia API](https://quranpedia.net/api-docs), mushaf 1 / tafsir book 1 | Live, bounded retrieval; failures are disclosed |

Hugging Face is the machine-readable index's distribution host, **not the religious
authority**. The UI shows the original collection and available reference. It never
uses the dataset host as the religious source, infers a narrator or grading, or
asserts an unknown edition. Dataset provenance is kept separately in documentation
and source metadata for audit.

## Local indexing role and limits

The pinned [meeAtif/hadith_datasets card](https://huggingface.co/datasets/meeAtif/hadith_datasets/blob/cd62605e4fef3c46968a5f9fdcccbbbffdf631b5/README.md)
credits Atif (@meeAtif) and declares MIT. The import contains 7,277 Bukhari and 7,368
Muslim **records**, including variants and grouped identifiers. English translations
and additional collections are not imported. The card does not establish a known
edition, an upstream permissions audit, or independent authentication of every row;
no separate license/copyright notice was supplied. The declaration is recorded,
not independently certified. Do not represent these files as an audited edition
or redistribute them without preserving this attribution and checking applicable
upstream terms. See [the corpus manifest and details](../data/hadith/README.md).

Every imported `Arabic_Text` is preserved character-for-character, including isnad,
diacritics, punctuation and direction marks. SHA-256 checks authenticate the bundled
files against the pinned import, **not against an original manuscript**. Matching
normalization occurs in a separate index only. Reference ranges/suffixes are kept;
unknown grading, narrator, scholar, edition and page metadata remain unknown.
All upstream Grade fields were empty; collection membership is never displayed as
a dataset-supplied grading verdict. Some supplied chapter labels can differ from
the linked reference page, so chapter metadata is not an edition citation.

## Narrow supported Patch scope

Patch presently accepts only evidence whose ID, exact Arabic text, source name,
reference and canonical URL match the checksum-checked local Sahihayn records.
Caller-supplied narrator/grade metadata is discarded in favor of stored fields.
Mixed, Dorar-only and Quranpedia-only snapshots yield `NO_SAFE_PATCH`, rather than
pretending their provenance has been authenticated for correction. Quran/tafsir
retrieval and reasoning remain implemented; **Quran/tafsir Patch is future work**.
This narrowing preserves useful functionality without compensating for provenance
limits with generated evidence. Authenticated indexing does not establish that
every model correction is semantically correct; published religious wording still
requires qualified human review.

## Availability and insufficient evidence

Local matches return immediately, at most five candidates, without Dorar or
Quranpedia calls. `DORAR_ENABLED=false` disables Dorar entirely. On a local miss,
optional live search may return more evidence; an outage is explicitly disclosed.
No fabricated cross-check, grading or replacement corpus is used. An empty result
is current-scope absence, not proof of universal falsity. Missing/corrupt bundled
data produces a sanitized service failure, not a fake result.

With no evidence, reasoning deterministically returns `NEEDS_CONTEXT / NONE`.
Patch returns `NO_SAFE_PATCH`: «لا تتوفر أدلة كافية ضمن المصادر المتاحة».
Specialist-required cases return `REFER_SPECIALIST` without a ruling or correction.
Explicit first-person religious applications have a narrow deterministic referral
boundary in both reasoning and Patch, even if an earlier AI analysis failed to
refer them. This is a conservative safety policy, not a complete fatwa detector.
Provider failure returns a safe error and no generated result. A supported claim
does not receive a forced correction.

## Manually reviewed competition references

On 2026-10-05, the project author inspected the Arabic passages and their linked
collection/reference pages for these three selected references:

| Local evidence ID | Approved reference | Validation used in demos/evaluation |
|---|---|---|
| `sahihayn-bukhari-1` | [صحيح البخاري، حديث 1](https://sunnah.com/bukhari:1), Book 1, Hadith 1 | Intentions proposition and the worldly/marriage migration qualification; no psychological-comfort condition is stated |
| `sahihayn-bukhari-71` | [صحيح البخاري، حديث 71](https://sunnah.com/bukhari:71), Book 3, Hadith 13 | The conditional wording about understanding religion; not a personal judgment |
| `sahihayn-muslim-223` | [صحيح مسلم، حديث 223](https://sunnah.com/muslim:223), Book 2, Hadith 1 | Purification excerpt and the explicit alternative that the Quran may be proof for or against a person |

This is a selected-reference reading check, not certification of the entire corpus,
grading, a scholarly consensus assessment or an edition audit. Orthography and
typography can differ; the imported string remains untouched. Each labeled case in
[evaluation/cases.ts](../evaluation/cases.ts) records its reference and rationale.
The insufficient-evidence case deliberately has no reference. Specialist labels
require referral; the selected passage is not used to issue the requested ruling.
