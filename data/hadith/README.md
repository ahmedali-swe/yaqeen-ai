# Sahihayn indexing representation

The production corpus contains **7,277 Sahih al-Bukhari records** and **7,368
Sahih Muslim records**, imported solely from
[meeAtif/hadith_datasets](https://huggingface.co/datasets/meeAtif/hadith_datasets)
at revision `cd62605e4fef3c46968a5f9fdcccbbbffdf631b5`, inspected on 2026-10-05.
No other collection is included. These are record counts, including narration
variants and grouped references, not counts of unique prophetic statements or a
claim that every edition is complete.

## Provenance and declared license

The [pinned dataset card](https://huggingface.co/datasets/meeAtif/hadith_datasets/blob/cd62605e4fef3c46968a5f9fdcccbbbffdf631b5/README.md)
credits **Atif (@meeAtif)** and declares **MIT** in its metadata. It provides
Sunnah.com reference links, but does not describe an edition audit, independent
record-level authentication, or the chain of permissions for upstream material.
The repository supplies no separate LICENSE/copyright notice. The declared MIT
terms are linked at [SPDX](https://spdx.org/licenses/MIT.html); this attribution
and license declaration must accompany redistributed indexing files. The card's
license declaration is recorded, not independently certified. English translations
are excluded. No narrator, grading or edition is inferred from a collection name.

This dataset is a **machine-readable indexing representation**, not a religious
authority. Users see **صحيح البخاري / صحيح مسلم** and the supplied collection
reference; Hugging Face is documented as provenance, never presented as the
religious reference. Source URLs are the supplied Sunnah.com reference URLs;
Yaqeen does not scrape those pages or treat the host as an additional collection.
The LLM never generates religious source text.

## Observed source shape and normalization

Each JSON file is an array. Actual fields are `Book`, `Chapter_Number`,
`Chapter_Title_Arabic`, `Chapter_Title_English`, `Arabic_Text`, `English_Text`,
`Grade`, `Reference` and `In-book reference`. All imported rows have nonempty
Arabic text and unique reference URLs. Both files have only empty `Grade` values;
normalized grading is therefore null throughout. Independent narrator, scholar,
edition and page fields are absent and are not reconstructed.

`arabicText` is copied **exactly** from `Arabic_Text`, including diacritics,
punctuation, whitespace, directional marks and isnad. Only the search index removes
diacritics, normalizes common alif/ya forms and whitespace. Full source wording is
returned separately and never replaced by a trimmed matn or AI paraphrase.

Stable IDs and `hadithNumber` are derived from the provided reference identifier.
Suffixes and grouped ranges remain intact: examples include `8a`, `546b-d`,
`5709-5712`, `1697/1698a`, and `157L`. No range is expanded into invented records.
`chapter` retains the supplied Arabic title; `metadata.chapterNumber` retains the
dataset's number without asserting that it is a chapter number in every edition.
Blank/missing optional metadata becomes null. The human-readable reference labels
the collection and supplied identifier, not a newly assigned number.

## Reproduction and integrity

```sh
pnpm exec tsx scripts/import-sahihayn.ts
# Offline replay using the two unmodified upstream files renamed bukhari.json / muslim.json:
pnpm exec tsx scripts/import-sahihayn.ts --input-dir /path/to/upstream-files
```

The importer downloads only the two pinned files, checks SHA-256 and expected
counts, validates both before writing, and fails on duplicate/invalid references
or unknown source shape. `manifest.json` records upstream URLs/hashes and normalized
file hashes. Runtime validates the bundled files against these hashes and schemas;
missing/corrupt primary files fail explicitly. There is no startup download or
fallback to test fixtures. Next file tracing includes both corpus files for the
evidence, Patch and health routes; standalone deployments must preserve `data/hadith/`.

Search is Arabic lexical retrieval, limited to Sahihayn, with at most five
candidates. It is not authentication, complete edition coverage, semantic search
or claim verification. Source transcription/numbering issues remain possible and
must be checked against the original collection before publishing religious work.
