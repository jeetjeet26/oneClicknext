'use client';

import { Loader2 } from 'lucide-react';
import { usePropertyContext } from './PropertyContext';

export function PropertySwitchOverlay() {
  const {
    isSwitchingProperty,
    switchingToProperty,
  } = usePropertyContext();

  if (!isSwitchingProperty) {
    return null;
  }

  const targetName = switchingToProperty?.name || 'selected property';

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-50/80 backdrop-blur-[2px]">
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-lg">
        <Loader2 className="h-5 w-5 animate-spin text-slate-600" />
        <div>
          <p className="text-sm font-medium text-slate-900">Switching property</p>
          <p className="text-xs text-slate-500">Loading {targetName}...</p>
        </div>
      </div>
    </div>
  );
}
