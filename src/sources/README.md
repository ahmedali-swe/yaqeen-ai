# Approved source boundary

The registry is empty. Do not treat an empty registry as approval of any source.

Before a source is added, an accountable reviewer must record its canonical URL,
edition, language, provenance, permitted use, approval date and scope in an
`ApprovedSource` entry. Check rights and attribution requirements first.

Future ingestion belongs behind this boundary, with exact original passages,
surrounding context, stable locators and edition information preserved. Never
overwrite evidence with summaries or silently switch editions. Human review is
required for specialist questions and future Yaqeen Patch publication.

There are no source adapters, crawlers, seed records, embeddings or network calls
in this foundation. Registry entries and database `approved_sources` rows will
need a deliberate synchronization mechanism when ingestion is introduced.
