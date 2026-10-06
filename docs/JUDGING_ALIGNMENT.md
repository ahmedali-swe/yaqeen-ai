# Implementation evidence for judging

This mapping describes implemented behavior, not promises. No official competition
rubric or track definition was supplied; the track-success row below is an explicit
product acceptance proxy, not an asserted organizer criterion.

| Dimension | Implemented evidence | Tests / measurement / documentation |
|---|---|---|
| Technical quality and AI use | Server-only Groq strict-schema extraction, independent relation reasoning, bounded Patch edits; Next App Router/TypeScript | `tests/groq.test.ts`, `tests/groq-reasoning.test.ts`, `tests/yaqeen-patch.test.ts`, API tests; live evaluation artifacts; README |
| Scientific reliability | Approved exact evidence separate from interpretation; explicit evidence-scoped verdicts; unknown metadata remains unknown; local Patch authentication | `tests/sahihayn.test.ts`, `tests/evidence-reasoning.test.ts`, `tests/yaqeen-patch.test.ts`; SOURCE_PROVENANCE.md; 10 provisional labeled cases with stated limitations |
| Innovation and value | Detect that a real quotation does not prove a broader author's conclusion; propose a minimum evidence-preserving correction | Comfort-inference evaluation vs presence-only baseline; scenario 1; patch edit-script/source-binding tests |
| User experience | Arabic RTL, selected-claim trace, Arabic badges, evidence reuse without inherited validity, before/after Patch, loading/error/empty/referral states; hidden image input | `tests/ui.test.tsx`, `tests/evidence-ui.test.tsx`, `tests/relation-ui.test.tsx`, `tests/patch-ui.test.tsx`; DEMO_SCENARIOS.md |
| Track-success proxy | Complete text → extraction → approved evidence → independent relation → safe correction/abstention | Real Arabic API acceptance and live Patch result; repeated key cases; docs/ACCEPTANCE.md |
| Operational realism | Bundled Sahihayn read-only retrieval, Dorar optional, no required database/Docker for demo, safe health and Vercel tracing | `tests/dorar.test.ts`, `tests/health.test.ts`, request budgets; production build; README deployment instructions |
| Verifiability | Stable evidence IDs, approved canonical links, import hashes, exact source immutability, reproducible labeled live CLI | `data/hadith/manifest.json`, `scripts/import-sahihayn.ts`, `scripts/evaluate-live.ts`, evaluation JSON results and EVALUATION.md |

Do not describe structural validation or a small selected evaluation as scholarly
certification. The source index is not an audited edition, the model is not a
religious authority, and Patch is a proposal requiring review. Hosted Vercel smoke
tests remain a deployment step until actually performed. Future work is identified
separately in README and is not counted as implementation evidence.
