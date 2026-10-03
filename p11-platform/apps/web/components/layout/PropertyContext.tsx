'use client';

import { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

type Property = { id: string; name: string; city?: string };
type PropertyContextValue = {
  properties: Property[];
  currentProperty: Property;
  loading: boolean;
  loadError: string | null;
  hasLoadedProperties: boolean;
  isSwitchingProperty: boolean;
  switchingFromProperty: Property | null;
  switchingToProperty: Property | null;
  setProperty: (id: string) => void;
  refreshProperties: (preferredId?: string) => Promise<boolean>;
};
type PropertyState = {
  properties: Property[];
  selectedId: string;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
};
const PropertyContext = createContext<PropertyContextValue | null>(null);
// The empty value carries no usable resource identity. Product pages wait at PropertyBoundary.
const NO_PROPERTY: Property = { id: '', name: 'No property selected' };
const STORAGE_KEY = 'p11_selected_property_id';
const PROPERTY_SWITCH_MIN_DURATION_MS = 700;

function extractPropertyIdFromPath(pathname: string): string | null {
  return pathname.match(/\/dashboard\/(?:brandforge|properties)\/([a-f0-9-]{36})(?:\/|$)/i)?.[1] ?? null;
}
function storedSelection(): string | null {
  try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function parseProperties(data: unknown): Property[] {
  if (!data || typeof data !== 'object' || !('properties' in data) || !Array.isArray(data.properties)) {
    throw new Error('Invalid property response');
  }
  const ids = new Set<string>();
  return data.properties.map((value: unknown) => {
    if (!value || typeof value !== 'object' || !('id' in value) || !('name' in value) ||
        typeof value.id !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value.id) ||
        typeof value.name !== 'string' || !value.name.trim() || ids.has(value.id)) {
      throw new Error('Invalid property response');
    }
    ids.add(value.id);
    const row = value as { id: string; name: string; settings?: { city?: unknown }; address?: { city?: unknown } };
    const city = row.settings?.city ?? row.address?.city;
    return { id: row.id, name: row.name, city: typeof city === 'string' ? city : undefined };
  });
}

export function PropertyProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<PropertyState>({ properties: [], selectedId: '', status: 'loading', error: null });
  const [switchingProperties, setSwitchingProperties] = useState<{ from: Property | null; to: Property } | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const pathnameRef = useRef(pathname);
  const switchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);

  const refreshProperties = useCallback(async (preferredId?: string) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState(previous => ({ ...previous, status: 'loading', error: null }));
    try {
      const response = await fetch('/api/properties', { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Property request failed');
      const properties = parseProperties(await response.json());
      if (controller.signal.aborted) return false;
      if (preferredId && !properties.some(property => property.id === preferredId)) throw new Error('Saved property not returned');
      const urlId = extractPropertyIdFromPath(pathnameRef.current);
      const storedId = storedSelection();
      setState(previous => {
        const selectedId = [preferredId, urlId, previous.selectedId, storedId]
          .find(id => properties.some(property => property.id === id)) ?? properties[0]?.id ?? '';
        return { properties, selectedId, status: 'ready', error: null };
      });
      return true;
    } catch {
      if (controller.signal.aborted) return false;
      setState({ properties: [], selectedId: '', status: 'error', error: 'We couldn’t load your properties. Try again to continue.' });
      return false;
    }
  }, []);

  useEffect(() => {
    void refreshProperties();
    return () => { controllerRef.current?.abort(); };
  }, [refreshProperties]);

  // A property URL wins on navigation, but a manual switch remains usable on that page.
  useEffect(() => {
    const id = extractPropertyIdFromPath(pathname);
    if (id) setState(previous => previous.properties.some(property => property.id === id)
      ? { ...previous, selectedId: id } : previous);
  }, [pathname]);

  useEffect(() => {
    if (state.status !== 'ready') return;
    try {
      if (state.selectedId) window.localStorage.setItem(STORAGE_KEY, state.selectedId);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch { /* Selection still works when browser storage is unavailable. */ }
  }, [state.selectedId, state.status]);

  useEffect(() => () => { if (switchTimeoutRef.current) clearTimeout(switchTimeoutRef.current); }, []);

  const setProperty = useCallback((id: string) => {
    if (state.status !== 'ready' || state.selectedId === id) return;
    const to = state.properties.find(property => property.id === id);
    if (!to) return;
    // A saved knowledge record belongs to the previous property. Remove its
    // deep link before the boundary mounts the newly selected property's page.
    if (pathnameRef.current === '/dashboard/community') {
      const url = new URL(window.location.href);
      for (const key of ['knowledgeGroup', 'knowledgeFile', 'knowledgeSource', 'knowledgeVersion',
        'knowledgeExtraction', 'knowledgeCapture', 'assistantFactVersion', 'unitReview', 'unitVersion']) {
        url.searchParams.delete(key);
      }
      window.history.replaceState(window.history.state, '', url);
    }
    if (switchTimeoutRef.current) clearTimeout(switchTimeoutRef.current);
    setSwitchingProperties({ from: state.properties.find(property => property.id === state.selectedId) ?? null, to });
    switchTimeoutRef.current = setTimeout(() => {
      setSwitchingProperties(null);
      switchTimeoutRef.current = null;
    }, PROPERTY_SWITCH_MIN_DURATION_MS);
    setState(previous => ({ ...previous, selectedId: id }));
  }, [state]);

  const contextValue = useMemo<PropertyContextValue>(() => ({
    properties: state.status === 'ready' ? state.properties : [],
    currentProperty: state.status === 'ready' ? state.properties.find(property => property.id === state.selectedId) ?? NO_PROPERTY : NO_PROPERTY,
    loading: state.status === 'loading',
    loadError: state.error,
    hasLoadedProperties: state.status === 'ready',
    isSwitchingProperty: switchingProperties !== null,
    switchingFromProperty: switchingProperties?.from ?? null,
    switchingToProperty: switchingProperties?.to ?? null,
    setProperty,
    refreshProperties,
  }), [state, switchingProperties, setProperty, refreshProperties]);

  return <PropertyContext.Provider value={contextValue}>{children}</PropertyContext.Provider>;
}

export function usePropertyContext() {
  const context = useContext(PropertyContext);
  if (!context) throw new Error('usePropertyContext must be used within PropertyProvider');
  return context;
}
