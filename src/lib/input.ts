export const MAX_TEXT_LENGTH = 10_000;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function validateText(text: string): string | null {
  if (!text.trim()) return "أضف النص الذي تريد تحليله أولًا.";
  if (text.length > MAX_TEXT_LENGTH) return "يجب ألا يتجاوز النص ١٠٬٠٠٠ حرف.";
  return null;
}

export function validateImage(file: Pick<File, "size" | "type">): string | null {
  if (!IMAGE_TYPES.some((type) => type === file.type)) return "اختر صورة بصيغة PNG أو JPG أو WebP.";
  if (file.size === 0) return "الصورة فارغة. اختر ملفًا آخر.";
  if (file.size > MAX_IMAGE_BYTES) return "يجب ألا يتجاوز حجم الصورة ٥ ميغابايت.";
  return null;
}
