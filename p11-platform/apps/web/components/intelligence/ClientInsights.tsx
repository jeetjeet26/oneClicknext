"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { clientPortalHref } from "@/utils/client-portal/navigation";
import styles from "./intelligence.module.css";
import { ClientPortalHeader } from "@/components/client-portal/ClientPortalHeader";
import { InsightsView } from "./InsightsView";
export function ClientInsights({
  name,
  hasConversations,
  properties = [],
}: {
  name: string;
  hasConversations: boolean;
  properties?: Array<{ id: string; name: string }>;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const propertyId = params.get('propertyId') || undefined;
  const days = ['7', '30', '90'].includes(params.get('days') ?? '') ? params.get('days')! : '30';
  const href = (path: string, change: Record<string, string> = {}) => clientPortalHref(path, params, change);
  return (
    <div className={`${styles.surface} console-shell portal-shell min-h-dvh`}>
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-white focus:p-3"
        href="#client-content"
      >
        Skip to content
      </a>
      <ClientPortalHeader
        view="insights"
        name={name}
        hasConversations={hasConversations}
        href={href}
      />
      <main
        id="client-content"
        tabIndex={-1}
        className="portal-main space-y-6"
      >
        <header className="portal-page-heading">
          <div><p className="console-kicker">{properties.find(p => p.id === propertyId)?.name ?? 'Your portfolio'}</p><h1>Changes &amp; explanations</h1><p>Understand recent changes and reviewed next steps.</p></div>
          <div className="portal-filters">
            <label><span className="sr-only">Property</span><select aria-label="Property" value={propertyId ?? ''} onChange={e => router.push(href('/client/insights', {propertyId: e.target.value}))}><option value="">All properties</option>{properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label><span className="sr-only">Reporting period</span><select aria-label="Reporting period" value={days} onChange={e => router.push(href('/client/insights', {days: e.target.value}))}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label>
          </div>
        </header>
        <InsightsView key={`${propertyId ?? 'all'}:${days}`} client propertyId={propertyId} propertyName={properties.find(p => p.id === propertyId)?.name} periodDays={Number(days)} />
      </main>
    </div>
  );
}
