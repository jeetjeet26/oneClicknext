'use client';

import React from 'react';
import { ChevronDown } from 'lucide-react';
import { usePropertyContext } from './PropertyContext';

export function PropertySwitcher() {
  const {
    properties,
    currentProperty,
    setProperty,
    loading,
    loadError,
    isSwitchingProperty,
  } = usePropertyContext();

  return (
    <div className="console-property-switcher min-w-0">
      <div className="flex min-w-0 flex-col">
        <span className="text-[10px] text-slate-500">Property</span>
        <select
          aria-label="Property"
          className="min-w-0 w-full truncate text-xs font-medium text-slate-900 bg-transparent focus-visible:outline-2 focus-visible:outline-indigo-600"
          value={currentProperty.id}
          onChange={(e) => setProperty(e.target.value)}
          disabled={loading || isSwitchingProperty || properties.length === 0}
        >
          {loading && (
            <option value={currentProperty.id}>Loading properties...</option>
          )}
          {!loading && properties.length === 0 && <option value="">{loadError ? 'Properties unavailable' : 'No properties yet'}</option>}
          {!loading &&
            properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}{property.city ? ` • ${property.city}` : ''}
              </option>
            ))}
        </select>
      </div>
      <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-slate-500" />
    </div>
  );
}

