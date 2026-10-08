"use client";
import styles from "./intelligence.module.css";
import { ClientPortalHeader } from "@/components/client-portal/ClientPortalHeader";
import { InsightsView } from "./InsightsView";
export function ClientInsights({
  name,
  hasConversations,
}: {
  name: string;
  hasConversations: boolean;
}) {
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
        href={(path) => path}
      />
      <main
        id="client-content"
        tabIndex={-1}
        className="mx-auto max-w-7xl space-y-8 px-6 py-10"
      >
        <header>
          <p className="text-xs font-medium uppercase tracking-widest text-[#b23c1f]">
            Your portfolio
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-gray-900">
            Understand what changed.
          </h1>
          <p className="mt-3 text-gray-600">
            Property comparisons, source coverage and reviewed next steps.
          </p>
        </header>
        <InsightsView client />
      </main>
    </div>
  );
}
