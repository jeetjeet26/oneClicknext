'use client'

/**
 * Monitoring settings + durable run history.
 * Replaces the old inert Settings button: comp-set policy, cadence, and a
 * ledger-backed history of what actually ran (including partial outcomes).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {sendMarketDecision} from '@/utils/marketvision/decision-client'
import {MarketRunHistory} from './MarketRunHistory'
import {MarketDecisionHistory} from './MarketDecisionHistory'
import {
  Loader2,
  Save,
  Settings,
} from 'lucide-react'

interface MonitoringConfig {
  id: string
  version: number
  is_enabled: boolean
  scrape_frequency: string
  radius_miles: number | null
  max_competitors: number | null
  auto_add: boolean | null
  last_run_at: string | null
  error_count: number | null
  last_error: string | null
}

interface MonitoringPanelProps {propertyId:string;openRequestId?:string}

export function MonitoringPanel({ propertyId,openRequestId }: MonitoringPanelProps) {
  const controller=useRef<AbortController|null>(null)
  const [ready,setReady]=useState(false)
  const [canManage,setCanManage]=useState(false)
  const [reason,setReason]=useState('')
  const [historyVersion,setHistoryVersion]=useState(0)
  const [config, setConfig] = useState<MonitoringConfig | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [form, setForm] = useState({
    isEnabled: false,
    scrapeFrequency: 'manual',
    radiusMiles: 3,
    maxCompetitors: 20,
    autoAdd: false,
  })

  const load=useCallback(async()=>{
    controller.current?.abort();const c=new AbortController();controller.current=c;setIsLoading(true);setReady(false)
    try{const response=await fetch(`/api/marketvision/config?propertyId=${propertyId}`,{signal:c.signal,cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error||'Monitoring settings could not be loaded.');if(c.signal.aborted)return;setConfig(data.config);setCanManage(data.canManage);setForm({isEnabled:data.config?.is_enabled??false,scrapeFrequency:data.config?.scrape_frequency??'manual',radiusMiles:data.config?.radius_miles??3,maxCompetitors:data.config?.max_competitors??20,autoAdd:data.config?.auto_add??false});setReady(true)}catch(e){if(!c.signal.aborted){setConfig(null);setMessage({type:'error',text:e instanceof Error?e.message:'Monitoring settings could not be loaded.'})}}finally{if(!c.signal.aborted)setIsLoading(false)}
  },[propertyId])
  useEffect(()=>{void load();return()=>controller.current?.abort()},[load])

  const save = async () => {
    setIsSaving(true)
    setMessage(null)
    try {
      await sendMarketDecision('/api/marketvision/config','PUT',{propertyId,expectedVersion:config?.version??0,reason,values:{is_enabled:form.isEnabled,scrape_frequency:form.scrapeFrequency,radius_miles:form.radiusMiles,max_competitors:form.maxCompetitors,auto_add:form.autoAdd}})
      setHistoryVersion(v=>v+1)
      setReason('')
      await load()
      setMessage({ type: 'success', text: 'Monitoring settings saved' })
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save settings',
      })
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading monitoring settings…
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Settings */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <Settings className="w-5 h-5 text-gray-500" /> Monitoring settings
        </h3>

        <fieldset disabled={!ready||!canManage||isSaving} className="space-y-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.isEnabled}
            onChange={(e) => setForm((f) => ({ ...f, isEnabled: e.target.checked }))}
            className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">
            Prefer scheduled monitoring when activated
          </span>
        </label>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Refresh cadence
          </label>
          <select
            aria-label="Refresh cadence" value={form.scrapeFrequency}
            onChange={(e) => setForm((f) => ({ ...f, scrapeFrequency: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="manual">Manual only</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Discovery radius: {form.radiusMiles} miles
          </label>
          <input
            type="range"
            min="0.5"
            max="25" step="0.5"
            aria-label="Discovery radius" value={form.radiusMiles}
            onChange={(e) => setForm((f) => ({ ...f, radiusMiles: Number(e.target.value) }))}
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Maximum competitors tracked
          </label>
          <select
            aria-label="Maximum competitors tracked" value={form.maxCompetitors}
            onChange={(e) => setForm((f) => ({ ...f, maxCompetitors: parseInt(e.target.value) }))}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
          >
            {![10,20,30,50].includes(form.maxCompetitors)&&<option value={form.maxCompetitors}>{form.maxCompetitors}</option>}
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={30}>30</option>
            <option value={50}>50</option>
          </select>
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.autoAdd}
            onChange={(e) => setForm((f) => ({ ...f, autoAdd: e.target.checked }))}
            className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">
            Prefer adding reviewed discoveries when activated
          </span>
        </label>

        <label className="block text-sm">Reason for settings change<textarea minLength={3} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)} className="block w-full border rounded p-2 mt-1" /></label>
        </fieldset>
        {!canManage&&ready&&<p className="text-sm text-gray-500">A property manager can change these settings.</p>}
        <p className="text-sm text-gray-500">Saving preferences does not start a source refresh. Provider access and worker readiness are checked separately.</p>
        <button disabled={isSaving} onClick={()=>{setReason('');setMessage(null);void load()}} className="text-sm underline">Reload monitoring</button>
        {message && (
          <p
            className={`text-sm ${message.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}
          >
            {message.text}
          </p>
        )}

        <button
          onClick={save}
          disabled={isSaving||!ready||!canManage||reason.trim().length<3}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 text-sm"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save settings
        </button>

        {config?.last_run_at && (
          <p className="text-xs text-gray-500">
            Earlier recorded refresh: {new Date(config.last_run_at).toLocaleString()}
            {typeof config.error_count === 'number' && config.error_count > 0 && (
              <span className="text-amber-600"> · {config.error_count} source errors</span>
            )}
          </p>
        )}
      </section>

      <div className="lg:col-span-2"><MarketRunHistory key={`${propertyId}:${openRequestId??''}`} propertyId={propertyId} openRequestId={openRequestId}/></div>
      <div className="lg:col-span-2"><MarketDecisionHistory key={historyVersion} propertyId={propertyId} /></div>
    </div>
  )
}
