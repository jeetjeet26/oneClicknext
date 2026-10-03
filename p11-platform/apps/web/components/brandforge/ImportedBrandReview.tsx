"use client"
import { useId } from 'react'

const hidden = new Set(['_meta', 'contractVersion', 'origin', 'assetId', 'asset_id', 'id', 'sourceId', 'url', 'fontUrl'])
const names: Record<string, string> = { hex: 'Color value', alt: 'Image description', role: 'Use', variants: 'Logo options', identity: 'Name and story', logos: 'Logos', typography: 'Typography', colors: 'Colors', introduction: 'Introduction', positioning: 'Positioning and voice', audience: 'Audience', designElements: 'Design elements', photography: 'Photography', implementation: 'Using the brand' }
function label(key: string) { return names[key] || key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase()) }
function visible(value: unknown): boolean {
  if (value == null || value === '') return false
  if (Array.isArray(value)) return value.some(visible)
  if (typeof value === 'object') return Object.entries(value).some(([key, entry]) => !hidden.has(key) && visible(entry))
  return true
}
export function sourceName(source?: string) { return ({manual:'Entered values',package:'Uploaded package',website:'Existing website'} as Record<string,string>)[source || ''] || 'Saved source' }
export function sourceSummary(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(sourceSummary).filter(Boolean).slice(0,4).join(' · ')
  if (value && typeof value === 'object') return Object.entries(value).filter(([key]) => !hidden.has(key) && !['role','usage','restrictions','weights'].includes(key)).map(([,entry]) => sourceSummary(entry)).filter(Boolean).slice(0,4).join(' · ').slice(0,180)
  return ''
}
function Fields({ value, onChange, title, path }: { value: unknown; onChange: (value: unknown) => void; title: string; path: string }) {
  if (Array.isArray(value)) return <div className="space-y-3">{value.map((entry,index) => <div key={index} className="rounded-lg border border-slate-700 p-3"><Fields value={entry} onChange={next => onChange(value.map((old,i) => i === index ? next : old))} title={`${title} ${index + 1}`} path={`${path}-${index}`} /><button type="button" className="mt-2 text-xs text-rose-300" onClick={() => onChange(value.filter((_,i) => i !== index))}>Remove {title.toLowerCase()} {index + 1}</button></div>)}</div>
  if (value && typeof value === 'object') {
    const item = value as Record<string,unknown>
    return <div className="space-y-3">
      {typeof item.url === 'string' && /^https?:\/\//.test(item.url) && <div className="rounded-lg bg-white p-4">
        {/* Governed source URLs must be preserved; the approval service rechecks rights and ownership. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.url} alt={typeof item.alt === 'string' ? item.alt : 'Imported logo'} className="max-h-28 max-w-full object-contain" />
      </div>}
      {Object.entries(item).filter(([key,entry]) => !hidden.has(key) && (visible(entry) || ['name','tagline','story','content','family','alt'].includes(key))).map(([key,entry]) => <Fields key={key} title={label(key)} path={`${path}-${key}`} value={entry} onChange={next => onChange({...item,[key]:next})} />)}
    </div>
  }
  if (typeof value === 'boolean') return <label className="flex gap-2"><input type="checkbox" checked={value} onChange={event => onChange(event.target.checked)} />{title}</label>
  if (typeof value === 'number') return <label className="block text-sm text-slate-300">{title}<input id={path} type="number" value={value} onChange={event => onChange(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-white" /></label>
  const text = typeof value === 'string' ? value : ''
  return <div><label className="block text-sm text-slate-300" htmlFor={path}>{title}
    {/^#[0-9a-f]{6}$/i.test(text) && <span className="ml-2 inline-block h-4 w-8 rounded border border-slate-500 align-middle" style={{backgroundColor:text}} />}
    </label><textarea id={path} value={text} rows={text.length > 100 ? 4 : 1} onChange={event => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-white" />
  </div>
}
export function ImportedBrandReview({ contract, onChange }: { contract: Record<string,unknown>; onChange: (key: string, value: unknown) => void }) {
  const id = useId()
  const entries = Object.entries(contract).filter(([key,value]) => !hidden.has(key) && visible(value))
  return <div className="space-y-3">{entries.sort(([a],[b]) => (a === 'identity' ? -1 : b === 'identity' ? 1 : 0)).map(([key,value]) => <details key={key} open={['identity','logos','colors'].includes(key)} className="rounded-xl border border-slate-700 bg-slate-900/60 p-4"><summary className="cursor-pointer font-semibold text-white">{label(key)}</summary><div className="mt-4"><Fields value={value} title={label(key)} path={`${id}-${key}`} onChange={next => onChange(key,next)} /></div></details>)}</div>
}
