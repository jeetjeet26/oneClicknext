"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { selectPackageDirection } from "@/utils/siteforge/packages/direction";
import { ReviewedRecordsWorkspace } from "@/components/intelligence/ReviewedRecordsWorkspace";

export function WebsiteDesignBrief({ propertyId, propertyName }: { propertyId: string; propertyName: string }) {
  const [result, setResult] = useState<{ selected: ReturnType<typeof selectPackageDirection> } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/intelligence?kind=direction&propertyId=${propertyId}`, { signal: controller.signal })
      .then(async r => { const value = await r.json(); if (!r.ok) throw new Error(value.error); return value; })
      .then(value => { if (!controller.signal.aborted) setResult(value); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [propertyId]);
  if (error) return <p role="alert">{error}</p>;
  if (!result) return <p role="status">Loading the approved design direction…</p>;
  if (result.selected?.source === "website") return <section className="space-y-5">
    <h1 className="text-2xl font-semibold">Website design direction · {propertyName}</h1>
    <div className="rounded-xl border bg-white p-5 text-gray-900">
      <h2 className="font-semibold">Active direction: {result.selected.name}</h2>
      <p className="mt-2 text-sm">This approved website direction governs new builds. Changes belong in the website’s design review.</p>
      <Link className="mt-3 inline-block text-sm underline" href={`/dashboard/siteforge/${result.selected.websiteId}`}>Open website design review</Link>
    </div>
    <details className="rounded-xl border p-5"><summary className="cursor-pointer font-medium">Earlier property design brief and history</summary>
      <p className="my-3 text-sm">Retained for reference. This brief does not override the active website direction.</p>
      <ReviewedRecordsWorkspace propertyId={propertyId} propertyName={propertyName} mode="creative" readOnly />
    </details>
  </section>;
  return <ReviewedRecordsWorkspace propertyId={propertyId} propertyName={propertyName} mode="creative" />;
}
