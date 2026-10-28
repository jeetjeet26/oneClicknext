'use client'

import { useState } from 'react'
import { Monitor, Smartphone, RotateCw, ExternalLink } from 'lucide-react'

export function PackagePreview({url,isWordPress}:{url:string|null;isWordPress:boolean}) {
  const [mobile,setMobile]=useState(false)
  const [reload,setReload]=useState(0)
  return <section aria-label="Website preview" className="min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-stone-100">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-4 py-3">
      <h3 className="text-sm font-semibold">Website preview</h3>
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Desktop preview" aria-pressed={!mobile} onClick={()=>setMobile(false)} className={`rounded-lg p-2 ${!mobile?'bg-indigo-100 text-indigo-700':'text-gray-600'}`}><Monitor className="h-4 w-4"/></button>
        <button type="button" aria-label="Mobile preview" aria-pressed={mobile} onClick={()=>setMobile(true)} className={`rounded-lg p-2 ${mobile?'bg-indigo-100 text-indigo-700':'text-gray-600'}`}><Smartphone className="h-4 w-4"/></button>
        <button type="button" aria-label="Reload website preview" disabled={!url} onClick={()=>setReload(value=>value+1)} className="rounded-lg p-2 text-gray-600 disabled:opacity-40"><RotateCw className="h-4 w-4"/></button>
        {url?<a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open preview in a new tab" className="rounded-lg p-2 text-gray-600"><ExternalLink className="h-4 w-4"/></a>:null}
      </div>
    </div>
    {url?<>
      <div className="overflow-auto p-2 sm:p-3"><iframe key={`${url}-${reload}`} src={url} title="Staging website preview" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" className={`mx-auto h-[70vh] min-h-[520px] border-0 bg-white shadow-sm ${mobile?'w-[390px] max-w-full':'w-full'}`}/></div>
      <p className="px-4 pb-3 text-xs text-gray-500">Browse pages inside the preview. This shows the current staging site. If it cannot be displayed here, use the new-tab button above.</p>
    </>:<div className="flex min-h-[400px] items-center justify-center p-8 text-center text-sm leading-6 text-gray-600">{isWordPress?'Create a WordPress staging preview below to review your website here alongside your feedback.':'An embedded preview is available for WordPress staging sites. Download this standalone package to review it, then request changes here.'}</div>}
  </section>
}
