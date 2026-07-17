'use client';

import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';

type Property = {
  id: string;
  name: string;
  city?: string;
};

type PropertyContextValue = {
  properties: Property[];
  currentProperty: Property;
  loading: boolean;
  isSwitchingProperty: boolean;
  switchingFromProperty: Property | null;
  switchingToProperty: Property | null;
  setProperty: (id: string) => void;
};

const PropertyContext = createContext<PropertyContextValue | null>(null);

const DEFAULT_PROPERTY_ID =
  process.env.NEXT_PUBLIC_DEFAULT_PROPERTY_ID ||
  '123e4567-e89b-12d3-a456-426614174000';

const DEFAULT_PROPERTIES: Property[] = [
  { id: DEFAULT_PROPERTY_ID, name: 'The Reserve at Sandpoint', city: 'Sandpoint, ID' },
  { id: '223e4567-e89b-12d3-a456-426614174000', name: 'Lakeside Flats', city: 'Austin, TX' },
  { id: '323e4567-e89b-12d3-a456-426614174000', name: 'Parkview Commons', city: 'Seattle, WA' },
];

const STORAGE_KEY = 'p11_selected_property_id';
const PROPERTY_SWITCH_MIN_DURATION_MS = 700;

// Helper to detect property ID from URL path
function extractPropertyIdFromPath(pathname: string): string | null {
  // Match patterns like /dashboard/brandforge/[uuid] or /dashboard/properties/[uuid]
  const patterns = [
    /\/dashboard\/brandforge\/([a-f0-9-]{36})/i,
    /\/dashboard\/properties\/([a-f0-9-]{36})/i,
  ];
  
  for (const pattern of patterns) {
    const match = pathname.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

export function PropertyProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [properties, setProperties] = useState<Property[]>(DEFAULT_PROPERTIES);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedId, setSelectedIdState] = useState<string>(DEFAULT_PROPERTY_ID);
  const [switchingProperties, setSwitchingProperties] = useState<{
    from: Property | null;
    to: Property | null;
  } | null>(null);
  
  // Use ref to track initialization without causing re-renders
  const initializedRef = useRef(false);
  const lastPathnameRef = useRef<string | null>(null);
  const switchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Wrapper to persist selection to localStorage
  const setSelectedId = useCallback((id: string) => {
    setSelectedIdState((prev) => {
      if (prev === id) return prev; // Prevent unnecessary updates
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, id);
      }
      return id;
    });
  }, []);

  const setProperty = useCallback((id: string) => {
    if (selectedId === id) return;

    const from = properties.find((property) => property.id === selectedId) || null;
    const to = properties.find((property) => property.id === id) || null;

    if (switchTimeoutRef.current) {
      clearTimeout(switchTimeoutRef.current);
    }

    setSwitchingProperties({ from, to });
    switchTimeoutRef.current = setTimeout(() => {
      requestAnimationFrame(() => {
        setSwitchingProperties(null);
        switchTimeoutRef.current = null;
      });
    }, PROPERTY_SWITCH_MIN_DURATION_MS);

    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, id);
    }

    setSelectedIdState(id);
  }, [properties, selectedId]);

  // Fetch properties (only on mount)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/properties');
        if (!res.ok) throw new Error('Failed to fetch properties');
        const data = await res.json();
        const fetched: Property[] = data.properties?.map((p: { id: string; name: string; settings?: { city?: string }; address?: { city?: string } }) => ({
          id: p.id,
          name: p.name,
          city: p.settings?.city ?? p.address?.city,
        })) ?? [];
        if (!cancelled && fetched.length) {
          setProperties(fetched);
        }
      } catch (err) {
        console.error('Property load error, using defaults', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (switchTimeoutRef.current) {
        clearTimeout(switchTimeoutRef.current);
      }
    };
  }, []);

  // Initialize property selection once when properties are loaded
  useEffect(() => {
    // Wait until we have real properties from the API
    if (properties === DEFAULT_PROPERTIES || properties.length === 0) return;
    
    // Only run initialization once
    if (initializedRef.current) return;
    initializedRef.current = true;
    
    // Priority 1: Check if there's a property ID in the URL
    const urlPropertyId = extractPropertyIdFromPath(pathname);
    if (urlPropertyId) {
      const existsInList = properties.some((p) => p.id === urlPropertyId);
      if (existsInList) {
        setSelectedId(urlPropertyId);
        return;
      }
    }
    
    // Priority 2: Check localStorage
    const storedId = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (storedId) {
      const existsInList = properties.some((p) => p.id === storedId);
      if (existsInList) {
        setSelectedId(storedId);
        return;
      }
    }
    
    // Priority 3: Use first property if current selection is invalid
    const currentExists = properties.some((p) => p.id === selectedId);
    if (!currentExists) {
      setSelectedId(properties[0].id);
    }
  }, [properties, pathname, selectedId, setSelectedId]);

  // Sync with URL changes when navigating to property-specific pages
  useEffect(() => {
    // Only after initialization
    if (!initializedRef.current) return;
    
    // Skip if pathname hasn't changed
    if (pathname === lastPathnameRef.current) return;
    lastPathnameRef.current = pathname;
    
    const urlPropertyId = extractPropertyIdFromPath(pathname);
    if (urlPropertyId && urlPropertyId !== selectedId) {
      const existsInList = properties.some((p) => p.id === urlPropertyId);
      if (existsInList) {
        setSelectedId(urlPropertyId);
      }
    }
  }, [pathname, properties, selectedId, setSelectedId]);

  const contextValue = useMemo<PropertyContextValue>(() => {
    const fallback = properties[0];
    const current = properties.find((p) => p.id === selectedId) || fallback;
    return {
      properties,
      currentProperty: current,
      loading,
      isSwitchingProperty: switchingProperties !== null,
      switchingFromProperty: switchingProperties?.from || null,
      switchingToProperty: switchingProperties?.to || null,
      setProperty,
    };
  }, [properties, selectedId, loading, switchingProperties, setProperty]);

  return <PropertyContext.Provider value={contextValue}>{children}</PropertyContext.Provider>;
}

export function usePropertyContext() {
  const ctx = useContext(PropertyContext);
  if (!ctx) {
    throw new Error('usePropertyContext must be used within PropertyProvider');
  }
  return ctx;
}


