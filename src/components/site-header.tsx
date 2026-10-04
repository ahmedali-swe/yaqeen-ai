import Link from "next/link";
import { ArrowUpLeft } from "lucide-react";
import { BrandMark } from "./icons";

export function SiteHeader() {
  return <header className="site-header">
    <div className="shell flex items-center justify-between gap-5">
      <Link href="/" className="brand" aria-label="يقين — الصفحة الرئيسية">
        <BrandMark /><span className="brand-name">يقين<span lang="en">YAQEEN</span></span>
      </Link>
      <nav aria-label="التنقل الرئيسي" className="flex items-center gap-7">
        <Link className="nav-link hidden sm:block" href="/#approach">منهج يقين</Link>
        <Link className="nav-cta" href="/#input">ابدأ من المحتوى <ArrowUpLeft size={16} aria-hidden="true" /></Link>
      </nav>
    </div>
  </header>;
}
