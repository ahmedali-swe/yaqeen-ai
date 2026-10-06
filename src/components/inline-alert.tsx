import { CircleAlert } from "lucide-react";
import { TEMPORARY_AI_MESSAGE } from "@/lib/ai-messages";

export function InlineAlert({ message, onRetry, id }: { message: string; onRetry: () => void; id?: string }) {
  return <div className="inline-alert" role="alert" id={id}>
    <CircleAlert size={20} aria-hidden="true" />
    <div><strong>تعذر إكمال التحليل مؤقتًا</strong><p>{message === TEMPORARY_AI_MESSAGE ? "حاول مرة أخرى بعد لحظات." : message}</p><p>لم يصدر يقين نتيجة غير موثقة.</p></div>
    <button type="button" className="retry-button" onClick={onRetry}>إعادة المحاولة</button>
  </div>;
}
