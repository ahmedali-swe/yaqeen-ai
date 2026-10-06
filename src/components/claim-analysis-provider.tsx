"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ClaimExtractionResult } from "@/domain/claim-extraction";
import { emptyReport, type ReportState } from "./analysis-flow";
import { readAnalysisSession, writeAnalysisSession, type AnalysisSession } from "./analysis-session";

const ClaimAnalysisContext = createContext<{
  result: ClaimExtractionResult | null;
  originalContent?: string;
  hydrated: boolean;
  report: ReportState;
  setReport: (update: (previous: ReportState) => ReportState) => void;
  setResult: (result: ClaimExtractionResult | null, originalContent?: string) => void;
} | null>(null);

export function ClaimAnalysisProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AnalysisSession | null>(null);
  const current = useRef<AnalysisSession | null>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try { current.current = readAnalysisSession(window.sessionStorage); setSession(current.current); } catch { /* Storage may be blocked. */ }
      setHydrated(true);
    });
    return () => { cancelled = true; };
  }, []);
  function replace(next: AnalysisSession | null) {
    current.current = next;
    setSession(next);
    // Write in the action, before route navigation or a possible refresh; never
    // perform storage side effects inside a React state updater.
    try { writeAnalysisSession(window.sessionStorage, next); } catch { /* Memory remains usable. */ }
  }
  return <ClaimAnalysisContext.Provider value={{ result: session?.result ?? null, originalContent: session?.originalContent, report: session?.report ?? emptyReport(), hydrated,
    setResult: (result, originalContent) => {
      const next: AnalysisSession | null = result ? { version: 1, id: crypto.randomUUID(), result, originalContent, report: emptyReport() } : null;
      replace(next);
    },
    setReport: (update) => { if (current.current) replace({ ...current.current, report: update(current.current.report) }); },
  }}>{children}</ClaimAnalysisContext.Provider>;
}

export function useClaimAnalysis() {
  const context = useContext(ClaimAnalysisContext);
  if (!context) throw new Error("ClaimAnalysisProvider is required");
  return context;
}
