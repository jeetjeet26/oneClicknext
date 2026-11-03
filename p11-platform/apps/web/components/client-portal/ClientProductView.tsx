"use client";
import { useState } from "react";
import type { readClientProduct } from "@/utils/client-portal/product-data";
import { portalProducts } from "@/utils/client-portal/products";
import { ClientPortalHeader } from "./ClientPortalHeader";
export function ClientProductView({ data }: { data: Awaited<ReturnType<typeof readClientProduct>> }) {
  const [property, setProperty] = useState("");
  const product = portalProducts.find(p => p.id === data.product)!;
  const rows = data.rows.filter(row => !property || row.propertyId === property);
  return <div className="console-shell portal-shell min-h-dvh">
    <ClientPortalHeader view={data.product} name={data.name} products={data.products} hasConversations={data.products.includes("lumaleasing")} href={path => path} />
    <main className="portal-main">
      <div className="portal-page-heading"><div><p className="console-kicker">Your portfolio</p><h1>{product.name}</h1><p>{product.description}</p></div>
        <label className="console-field-label">Property<select value={property} onChange={e => setProperty(e.target.value)}><option value="">All properties</option>{data.properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </div>
      <p className="console-muted mb-4">{data.product === "marketvision" ? "Up to 100 active competitors tracked by your team. Dates show the latest recorded collection." : "The 100 most recent stored reviews across your assigned properties. Dates reflect the original review."}</p>
      <div className="grid gap-4 md:grid-cols-2">{rows.map(row => <article className="console-panel p-6" key={row.id}>
        <p className="console-kicker">{row.property}</p><h2 className="text-lg font-semibold">{row.title}</h2>
        <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{row.detail || "No additional details available."}</p>
        <p className="console-muted mt-4">{row.date ? new Date(row.date).toLocaleDateString() : "Date unavailable"}</p>
      </article>)}</div>
      {!rows.length && <section className="console-panel console-empty"><h2>No {data.product === "marketvision" ? "competitors" : "reviews"} to show yet</h2><p>Your team’s updates will appear here when available.</p></section>}
    </main>
  </div>;
}
