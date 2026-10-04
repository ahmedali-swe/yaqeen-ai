import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "يقين | من المحتوى إلى الدليل", template: "%s | يقين" },
  description: "أساس منصة يقين لتتبّع الدليل وحفظ المعنى في المحتوى الإسلامي. التحقق الآلي قيد التطوير.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ar" dir="rtl"><body>
    <a className="skip-link" href="#main">انتقل إلى المحتوى</a>
    <SiteHeader />{children}<SiteFooter />
  </body></html>;
}
