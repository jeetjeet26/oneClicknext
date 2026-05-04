'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

declare global {
  interface Window {
    lumaleasing?: ((command: string, ...args: unknown[]) => void) & { q?: unknown[] };
    LUMALEASING_API_BASE?: string;
  }
}

const SCRIPT_ID = 'lumaleasing-embed-script';

function DemoContent() {
  const searchParams = useSearchParams();
  const apiKey = searchParams.get('apiKey');
  const [scriptStatus, setScriptStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  useEffect(() => {
    if (!apiKey) {
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    setScriptStatus('loading');

    window.LUMALEASING_API_BASE = window.location.origin;

    if (!window.lumaleasing) {
      const queue: unknown[] = [];
      const stub = function (...args: unknown[]) {
        queue.push(args);
      } as ((command: string, ...args: unknown[]) => void) & { q?: unknown[] };
      stub.q = queue;
      window.lumaleasing = stub;
    }

    window.lumaleasing('init', apiKey);

    let scriptEl = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!scriptEl) {
      scriptEl = document.createElement('script');
      scriptEl.id = SCRIPT_ID;
      scriptEl.async = true;
      scriptEl.src = `${window.location.origin}/lumaleasing.js`;
      scriptEl.onload = () => setScriptStatus('ready');
      scriptEl.onerror = () => setScriptStatus('error');
      document.body.appendChild(scriptEl);
    } else {
      setScriptStatus('ready');
    }

    return () => {
      // Closing the widget on unmount; leave the script cached for fast remounts.
      try {
        window.lumaleasing?.('close');
      } catch {
        // No-op; demo cleanup should never block navigation.
      }
    };
  }, [apiKey]);

  if (!apiKey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-md">
          <h1 className="text-xl font-bold text-gray-900 mb-4">LumaLeasing Demo</h1>
          <p className="text-gray-600 mb-4">
            To preview your widget, add your API key to the URL:
          </p>
          <code className="block p-3 bg-gray-100 rounded text-sm text-gray-800 break-all">
            /lumaleasing/demo?apiKey=YOUR_API_KEY
          </code>
          <p className="text-xs text-gray-500 mt-4">
            This page loads the same <code>lumaleasing.js</code> script clients embed,
            so what you see here matches the production embed behavior.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200">
      {/* Sample property website used purely to host the LumaLeasing widget for preview. */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg" />
            <span className="text-xl font-bold text-gray-900">LumaLeasing Embed Preview</span>
          </div>
          <span className="text-xs uppercase tracking-wide text-slate-500">
            Same script clients embed
          </span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-12">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden mb-12">
          <div className="h-72 bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center">
            <div className="text-center text-white">
              <h1 className="text-4xl font-bold mb-2">Live Embed Preview</h1>
              <p className="text-base opacity-90">
                The chat widget in the bottom corner is powered by the same loader your clients deploy.
              </p>
            </div>
          </div>
          <div className="p-8 text-sm text-slate-600 space-y-2">
            <p>
              Loader status: <span className="font-medium text-slate-900">{scriptStatus}</span>
            </p>
            {scriptStatus === 'error' && (
              <p className="text-red-600">
                Failed to load <code>/lumaleasing.js</code>. Verify the host is serving the embed script
                and the API key is active.
              </p>
            )}
            <p>
              Use this surface to validate branding, business hours, RAG answers, lead capture, and tour booking
              before sharing the embed snippet with the property.
            </p>
          </div>
        </div>
      </main>

      <footer className="bg-gray-900 text-gray-400 py-12 mt-12">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-sm">
            Internal preview environment. The embedded widget below is loaded from{' '}
            <code>/lumaleasing.js</code> exactly as a client would on their property website.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default function LumaLeasingDemoPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-100">
          <div className="animate-pulse text-gray-500">Loading…</div>
        </div>
      }
    >
      <DemoContent />
    </Suspense>
  );
}
