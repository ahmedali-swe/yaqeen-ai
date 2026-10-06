import { z } from "zod";

export const SAHIHAYN_REVISION = "cd62605e4fef3c46968a5f9fdcccbbbffdf631b5";
export const SAHIHAYN_DATASET = "meeAtif/hadith_datasets";
// Observed suffixes, grouped ranges and combined references remain intact.
export const SAHIHAYN_REFERENCE_ID_PATTERN = "\\d+[A-Za-z]*(?:-(?:\\d+[A-Za-z]*|[A-Za-z]+)|/\\d+[A-Za-z]*)?";
export const SahihaynCollectionSchema = z.enum(["bukhari", "muslim"]);
export type SahihaynCollection = z.infer<typeof SahihaynCollectionSchema>;
export const collectionNames = { bukhari: { english: "Sahih al-Bukhari", arabic: "صحيح البخاري" }, muslim: { english: "Sahih Muslim", arabic: "صحيح مسلم" } } as const;

export const SahihaynRecordSchema = z.strictObject({
  id: z.string().min(1).max(200),
  collection: SahihaynCollectionSchema,
  collectionArabic: z.enum(["صحيح البخاري", "صحيح مسلم"]),
  hadithNumber: z.string().regex(new RegExp(`^${SAHIHAYN_REFERENCE_ID_PATTERN}$`)),
  chapter: z.string().max(5000).nullable(),
  arabicText: z.string().min(1).max(100_000).refine((value) => value.trim().length > 0),
  reference: z.string().min(1).max(1000),
  sourceUrl: z.url().max(1000),
  metadata: z.strictObject({
    chapterNumber: z.number().int().nonnegative().nullable(),
    inBookReference: z.string().max(1000).nullable(),
    grading: z.string().max(5000).nullable(),
  }),
}).refine((record) => record.collectionArabic === collectionNames[record.collection].arabic &&
  record.id === `sahihayn-${record.collection}-${record.hadithNumber}` &&
  record.sourceUrl === `https://sunnah.com/${record.collection}:${record.hadithNumber}`);
export type SahihaynRecord = z.infer<typeof SahihaynRecordSchema>;

const nullableText = (value: string | null | undefined) => value?.trim() ? value : null;
/** Observed upstream fields. English translations are deliberately not retained. */
export function normalizeSahihaynDataset(raw: unknown, collection: SahihaynCollection): SahihaynRecord[] {
  const rowSchema = z.object({
    Book: z.literal(collectionNames[collection].english),
    Chapter_Number: z.number().int().nonnegative().nullish(),
    Chapter_Title_Arabic: z.string().max(5000).nullish(),
    Arabic_Text: z.string().min(1).max(100_000).refine((value) => value.trim().length > 0),
    Grade: z.string().max(5000).nullish(),
    Reference: z.string().regex(new RegExp(`^https://sunnah\\.com/${collection}:${SAHIHAYN_REFERENCE_ID_PATTERN}$`)),
    "In-book reference": z.string().max(1000).nullish(),
  });
  const rows = z.array(rowSchema).min(1).max(10_000).parse(raw);
  const seen = new Set<string>();
  return rows.map((row) => {
    if (seen.has(row.Reference)) throw new Error("Duplicate Sahihayn source reference");
    seen.add(row.Reference);
    const hadithNumber = row.Reference.split(":").at(-1)!;
    return SahihaynRecordSchema.parse({
      id: `sahihayn-${collection}-${hadithNumber}`, collection, collectionArabic: collectionNames[collection].arabic,
      hadithNumber, chapter: nullableText(row.Chapter_Title_Arabic), arabicText: row.Arabic_Text,
      reference: `${collectionNames[collection].arabic}، حديث ${hadithNumber}`, sourceUrl: row.Reference,
      metadata: { chapterNumber: row.Chapter_Number ?? null, inBookReference: nullableText(row["In-book reference"]), grading: nullableText(row.Grade) },
    });
  });
}
