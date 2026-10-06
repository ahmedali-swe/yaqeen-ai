# Offline source fixtures

`dorar-live.json` was captured directly from the official
`https://dorar.net/dorar_api.json?skey={encodedQuery}` endpoint on 2026-10-05.
The successful query was `من غشنا فليس منا`, HTTP 200, with top-level
`ahadith.result` containing 15 paired `hadith` / `hadith-info` HTML blocks.
The generic canonical API URL in its head is not an individual narration URL.
Its only other link is a search-results URL. The untouched JSON retains source
wording and all reported grading qualifications for deterministic parser tests.
Other live queries encountered HTTP 403 Cloudflare block pages; those are not
represented as successful JSON fixtures. Tests wrap this captured HTML in the
documented `ahadith[].th` envelope to check compatibility; that envelope is a
synthetic test wrapper, not a claim about a successful live response.

`hadith.json` and `local-hadith.ts` are the former three-entry development corpus
and its offline test adapter. They have no application imports, runtime use,
automatic outage fallback, database ingestion or claim-verification role.
The entries were manually checked against their cited Dorar narration blocks.
Additional adversarial HTML in tests is explicitly synthetic, using source text
from captured fixtures. Automated tests never contact Dorar or an AI provider.
