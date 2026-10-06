# Approved source boundary

The project owner approved local Sahihayn, Quranpedia, optional official Dorar search
and the official HadeethEnc hadith explanation layer
for this retrieval stage. `registry.ts` records that scope; approval is not a
scholarly endorsement or permission to crawl other sources.

- Quranpedia: live public JSON API, Hafs mushaf 1, bounded topic/verse lookup,
  and book 1 (تيسير التفسير, إبراهيم القطان) for explicitly cited interpretations.
  See the [API documentation and usage policy](https://quranpedia.net/api-docs).
  Unknown edition metadata stays unknown. No Quran text is rewritten.
- Sahihayn primary: 7,277 Bukhari and 7,368 Muslim records in `../../data/hadith/`.
  See [corpus provenance](../../data/hadith/README.md). The meeAtif dataset card
  declares MIT and supplies Sunnah.com references, but no edition audit or separate
  license notice. Exact Arabic, chapter and reference identifiers are retained;
  blank grades remain null. The host is an indexing representation, not a religious
  authority. Users see the original collection/reference. LOCAL_PRIMARY hits return
  without Dorar requests; explanation enrichment has a separate graceful deadline.
  No additional collections are included.
- HadeethEnc: official Arabic public search/detail API, approved explanation and
  reference support only. Deterministic matn matching selects records, never an
  LLM or demo-ID map. Original explanation/hadith/ref/grade/hints are retained.
  The observed API provides no public record URL, so none is invented. Three-second
  timeout, bounded cache and unavailable/no-match states preserve primary hadith
  coverage. Original text and clear attribution are retained under official reuse
  terms; live data refreshes after cache expiry. See
  [current official API shapes and source validation](../../docs/SOURCE_PROVENANCE.md).
- Dorar: server-only `GET https://dorar.net/dorar_api.json?skey={encodedQuery}`.
  See [official documentation](https://dorar.net/article/389). The documented
  `ahadith[].th` and observed `ahadith.result` HTML shapes are supported. Text
  and metadata are extracted deterministically, never reconstructed by an LLM.
  Grading belongs to the named scholar, not Yaqeen. Missing metadata and individual
  URLs remain null; a returned search URL is labeled separately. No Dorar HTML
  pages are fetched, and no broad crawling or ingestion occurs. This external
  dependency can time out or block requests, including observed HTTP 403 responses.
  DORAR_CROSSCHECK is optional live retrieval beyond the current corpus on a local
  miss, and can be disabled with `DORAR_ENABLED=false`. Local hits require no Dorar
  request. An outage after a local miss produces an honest empty/current-corpus
  result with source status, not a hard runtime dependency or fabricated cross-check.
  The old corpus/adapter live only in `../../tests/fixtures/`, outside application
  code. Automated tests use captured official JSON and clearly identified synthetic
  adversarial markup; no network calls or fallback corpus run in production.

No source scraping, database seeds or embeddings are included. Only the two
approved pinned dataset files are imported into checked-in indexing JSON.
The registry does not synchronize with database rows. Extending it requires a
deliberate review of provenance, exact text, edition, canonical links, permitted
use and scope. Never substitute generated wording for evidence. A lexical match
does not establish that evidence supports a claim; qualified review remains
necessary before publishing a verdict or proposed correction. See
[submission provenance and the narrow Patch scope](../../docs/SOURCE_PROVENANCE.md).
