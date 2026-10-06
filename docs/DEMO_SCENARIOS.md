# Three reproducible demonstrations

Use `AI_PROVIDER=groq`, a server-only `GROQ_API_KEY`,
`GROQ_TEXT_MODEL=openai/gpt-oss-120b`, and `DORAR_ENABLED=false`.
Start the app, paste the exact input, and use the existing claim selector, evidence,
relation and Patch actions. These are expected behaviors, not preloaded results.
Live classification can vary; failed calls must be retried explicitly, never
replaced with demonstration data. See [reference checks](SOURCE_PROVENANCE.md).

## Scenario 1 — a real quotation does not validate the inference

Exact input:

> قال الكاتب: «إنما الأعمال بالنيات»، ثم ذكر أن هذا الحديث يعني أن كل عمل لا يشعر صاحبه بالراحة النفسية هو عمل غير مقبول.

- Expected independent claims: the intentions quotation, and the author's
  psychological-comfort interpretation. Reporting punctuation/frame may be retained.
- Select the quotation and search. Expected primary evidence:
  `sahihayn-bukhari-1`, [صحيح البخاري، حديث 1](https://sunnah.com/bukhari:1).
  Reference manually checked: Book 1, Hadith 1; the intentions proposition is present.
- Analyze quotation: expected `SUPPORTED / DIRECT_QUOTE` (مدعوم / اقتباس مباشر).
  Patch should return `NO_SAFE_PATCH` because no correction is needed.
- Select the interpretation card, then **البحث عن الأدلة**. Direct retrieval is
  attempted first; “هذا الحديث” explicitly anchors it to the prior quotation.
  The UI shows **الدليل المشار إليه في السياق** with the same Bukhari passage.
  Choose **تحليل العلاقة** for an independent comparison. Expected
  `UNSUPPORTED / UNSUPPORTED_INFERENCE`; the passage states no psychological-comfort
  requirement for accepting work. It must not inherit the quotation's status.
- Patch may replace/remove only that unsupported inference with a minimal,
  faithful intentions statement, citing `sahihayn-bukhari-1`. The source and quotation
  remain unchanged. If no safe edit can be generated, show `NO_SAFE_PATCH`.
- Switch between claim cards: previously retrieved evidence, verdicts and Patch
  decisions remain visible without repeating AI calls.
- Known limitation: labels/edit wording are model-dependent. This is not a personal
  fatwa or an exhaustive theory of acceptance. Without an explicit contextual
  reference, an interpretation can legitimately return no matching evidence.

## Scenario 2 — preserve a supported Bukhari quotation

Exact input:

> من يرد الله به خيرا يفقهه في الدين.

- Expected claim: one independently checkable quotation (or religious statement)
  containing this proposition.
- Expected primary evidence: `sahihayn-bukhari-71`,
  [صحيح البخاري، حديث 71](https://sunnah.com/bukhari:71), Book 3, Hadith 13.
  Manually checked against the conditional wording of this passage.
- Expected relation: `SUPPORTED / DIRECT_QUOTE`; no judgment about a named person.
- Expected Patch: `NO_SAFE_PATCH`; preserve already faithful wording.
- Known limitation: extraction's claim type can vary; retrieval can also return
  narration variants. The tested first-ranked result is Bukhari 71. No edition or
  absent grading is asserted.

## Scenario 3 — preserve a supported Muslim quotation

Exact input:

> الطهور شطر الإيمان.

- Expected claim: one independently checkable quotation/religious proposition.
- Expected primary evidence: `sahihayn-muslim-223`,
  [صحيح مسلم، حديث 223](https://sunnah.com/muslim:223), Book 2, Hadith 1.
  The selected excerpt was manually checked in its longer passage.
- Expected relation: `SUPPORTED / DIRECT_QUOTE`; a short faithful excerpt alone
  does not imply misleading missing context.
- Expected Patch: `NO_SAFE_PATCH`; no forced rewriting of religious words.
- Known limitation: matching ignores diacritics, while the displayed source retains
  its exact imported spelling and longer narration. No claim about every edition
  or a complete Muslim database is made.
