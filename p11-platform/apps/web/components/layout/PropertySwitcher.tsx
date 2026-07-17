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
    isSwitchingProperty,
  } = usePropertyContext();

  return (
    <div className="flex items-center space-x-2 border border-slate-200 rounded-md px-3 py-1.5 bg-white">
      <div className="flex flex-col">
        <span className="text-xs text-slate-500">Property</span>
        <select
          className="text-sm font-medium text-slate-900 bg-transparent focus:outline-none"
          value={currentProperty.id}
          onChange={(e) => setProperty(e.target.value)}
          disabled={loading || isSwitchingProperty}
        >
          {loading && (
            <option value={currentProperty.id}>Loading properties...</option>
          )}
          {!loading &&
            properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}{property.city ? ` • ${property.city}` : ''}
              </option>
            ))}
        </select>
      </div>
      <ChevronDown size={14} className="text-slate-500" />
    </div>
  );
}

