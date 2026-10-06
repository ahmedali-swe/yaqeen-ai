import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ClaimAnalysisProvider } from "@/components/claim-analysis-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "يقين | من المحتوى إلى الدليل", template: "%s | يقين" },
  description: "يقين لاستخراج الادعاءات من النص العربي والإنجليزي، واسترجاع الأدلة المعتمدة وتحليل أمانة الاستدلال بها مع حفظ النص والمعنى.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><body>
    <a className="skip-link" href="#main">انتقل إلى المحتوى</a>
    <ClaimAnalysisProvider><SiteHeader />{children}<SiteFooter /></ClaimAnalysisProvider>
  </body></html>;
}
