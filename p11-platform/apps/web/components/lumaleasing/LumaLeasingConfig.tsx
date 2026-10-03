'use client';
import {LumaWidgetOperations} from './LumaWidgetOperations';
import {CalendarEventBinding} from '@/components/leads/CalendarEventBinding';

import {IntegrationReplacementPanel} from './IntegrationReplacementPanel';
import {IntegrationInvitesPanel} from './IntegrationInvitesPanel';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Save, RefreshCw, Eye, Palette, MessageSquare,
  UserPlus, Calendar, Code, Loader2,
  Sparkles, CheckCircle, AlertCircle, Mail, XCircle, Wrench
} from 'lucide-react';
import { usePropertyContext } from '../layout/PropertyContext';

interface WidgetConfig {
  id: string;
  property_id: string;
  widget_name: string;
  primary_color: string;
  secondary_color: string;
  logo_url: string | null;
  agent_avatar_url: string | null;
  welcome_message: string;
  offline_message: string;
  auto_popup_delay_seconds: number;
  require_email_before_chat: boolean;
  collect_name: boolean;
  collect_email: boolean;
  collect_phone: boolean;
  lead_capture_prompt: string;
  floor_plans_url: string | null;
  availability_url: string | null;
  tours_enabled: boolean;
  tour_duration_minutes: number;
  tour_buffer_minutes: number;
  business_hours: Record<string, { start: string; end: string } | null>;
  timezone: string | null;
  api_key: string;
  is_active: boolean;
}

// Older rows use short weekday keys. Present them explicitly in the editor;
// canonical long keys are persisted only when the operator saves.
function editableConfiguration(config:WidgetConfig,timezone:string|null):WidgetConfig {
  const aliases:Record<string,string>={monday:'mon',tuesday:'tue',wednesday:'wed',thursday:'thu',friday:'fri',saturday:'sat',sunday:'sun'};
  const hours=config.business_hours||{};
  return {...config,timezone,welcome_message:config.welcome_message||'',offline_message:config.offline_message||'',
    business_hours:Object.fromEntries(Object.entries(aliases).map(([day,short])=>{
      const value=Object.hasOwn(hours,day)?hours[day]:hours[short];
      return [day,value&&(!('enabled' in value)||value.enabled!==false)?{start:value.start,end:value.end}:null];
    }))};
}

interface EmailLifecycleSummary {
  total_threads: number;
  awaiting_internal_reply: number;
  awaiting_internal_reply_overdue: number;
  awaiting_lead_reply: number;
  active: number;
  other: number;
  latest_thread_activity_at: string | null;
}

interface PendingEmailThreadPreview {
  id: string;
  status: string | null;
  subject: string | null;
  last_message_at: string | null;
  message_count: number | null;
  lead_id: string | null;
  overdue: boolean;
  overdue_days: number | null;
}

import {CalendarChangeReview,type CalendarObservation} from '@/components/leads/CalendarChangeReview';

interface RecoveryBooking {
  schedule_timezone:string|null;
  schedule_version: number;
  id: string;
  lead: { name: string; email: string | null; phone: string | null } | null;
  scheduled_date: string;
  scheduled_time: string;
  duration_minutes: number | null;
  status: string | null;
  can_cancel: boolean;
  can_reschedule: boolean;
  calendar_event: (CalendarObservation & {google_event_id:string}) | null;
}

import {PropertyTimezoneSetup} from '@/components/leads/PropertyTimezoneSetup';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
];

export function LumaLeasingConfig() {
  const { currentProperty } = usePropertyContext();
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'branding' | 'behavior' | 'leads' | 'tours' | 'embed'>('branding');
  const [calendarStatus, setCalendarStatus] = useState<{
    connected: boolean;
    state?: 'connected' | 'reconnect_required' | 'disconnected' | 'setup_required';
    timezone?: string | null;
    timezone_setup_required?: boolean;
    provider?: 'google' | 'microsoft';
    email?: string;
    account_email?: string;
    token_status?: string;
    permission_state?: string;
    permission_message?: string | null;
    last_health_check_at?: string;
    webhook_capability?: {
      mode: 'push_watch' | 'unconfigured' | 'manual_check';
      ready: boolean;
      blockers: string[];
      watch_expires_at: string | null;
      watch_ttl_minutes: number | null;
      watch_last_message_number: number | null;
    };
    calendar_sync?: {
      total_events: number;
      synced_events: number;
      failed_events: number;
      external_drift_events: number;
      external_missing_events: number;
      external_cancelled_events: number;
      missing_event_bookings: number;
      degraded: boolean;
    };
  } | null>(null);
  const [emailStatus, setEmailStatus] = useState<{
    connected: boolean;
    state?: 'connected' | 'reconnect_required' | 'disconnected';
    message?: string;
    provider?: 'google' | 'microsoft';
    email?: string;
    account_email?: string;
    token_status?: string;
    permission_state?: string;
    permission_message?: string | null;
    auto_reply_enabled?: boolean;
    webhook_capability?: {
      mode: 'push_watch' | 'manual_check' | 'unconfigured';
      ready: boolean;
      blockers: string[];
      watch_expires_at: string | null;
      watch_ttl_minutes: number | null;
      history_id: string | null;
    };
    thread_lifecycle?: EmailLifecycleSummary;
    pending_threads_preview?: PendingEmailThreadPreview[];
  } | null>(null);
  const [resolvingThreadId, setResolvingThreadId] = useState<string | null>(null);
  const [repairingThreads, setRepairingThreads] = useState(false);
  const [repairingCalendarSync, setRepairingCalendarSync] = useState(false);
  const [recoveringBookingId, setRecoveringBookingId] = useState<string | null>(null);
  const [recoveryBookings, setRecoveryBookings] = useState<RecoveryBooking[]>([]);
  const [recoveryDrafts, setRecoveryDrafts] = useState<Record<string, { date: string; time: string; reason?:string }>>({});
  const recoveryRequest=useRef<Record<string,{key:string;id:string}>>({});
  const [calendarReviewMessage,setCalendarReviewMessage]=useState('');
  const [recoveryCursor,setRecoveryCursor]=useState<string|null>(null);
  const [recoveryLoading,setRecoveryLoading]=useState(false);
  const recoveryRead=useRef<AbortController|null>(null);
  useEffect(()=>()=>recoveryRead.current?.abort(),[]);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const disconnectRequest=useRef<{key:string;id:string}|null>(null);
  const [disconnectingIntegration, setDisconnectingIntegration] = useState<'calendar' | 'email' | null>(null);

  const [canManage,setCanManage]=useState(false);
  const [configError,setConfigError]=useState('');
  const [saveMessage,setSaveMessage]=useState('');
  const [dirty,setDirty]=useState(false);
  const [saveError,setSaveError]=useState('');
  const [saveConflict,setSaveConflict]=useState(false);
  const [revision,setRevision]=useState('');
  const configRead=useRef<AbortController|null>(null);
  const configWrite=useRef<AbortController|null>(null);
  const configIdentity=useRef<{signature:string;requestId:string}|null>(null);
  useEffect(()=>()=>{configRead.current?.abort();configWrite.current?.abort()},[]);
  const loadConfig = useCallback(async () => {
    configRead.current?.abort();const controller=new AbortController();configRead.current=controller;
    setLoading(true);setConfigError('');
    try {
      const res=await fetch(`/api/lumaleasing/admin/config?propertyId=${currentProperty.id}`,{signal:controller.signal,cache:'no-store'});
      const data=await res.json();
      if(!res.ok||typeof data.revision!=='string'||!('config' in data))throw new Error('Configuration is unavailable. Retry to load saved settings.');
      if(!controller.signal.aborted){setCanManage(data.canManage===true);setConfig(data.config?editableConfiguration(data.config,data.effectiveTimezone):null);setRevision(data.revision);setDirty(false);setSaveError('');setSaveConflict(false);configIdentity.current=null}
    } catch {
      if(!controller.signal.aborted)setConfigError('Configuration is unavailable. Retry to load saved settings.');
    } finally {if(!controller.signal.aborted)setLoading(false)}
  }, [currentProperty.id]);

  const [calendarLoading,setCalendarLoading]=useState(true);
  const [calendarError,setCalendarError]=useState('');
  const calendarRead=useRef<AbortController|null>(null);
  useEffect(()=>()=>calendarRead.current?.abort(),[]);
  const loadCalendarStatus = useCallback(async () => {
    calendarRead.current?.abort();
    const controller=new AbortController();calendarRead.current=controller;
    setCalendarLoading(true);setCalendarError('');
    try {
      const res=await fetch(`/api/lumaleasing/calendar/status?propertyId=${currentProperty.id}`,{signal:controller.signal});
      const data=await res.json();
      if(!res.ok)throw new Error('Calendar status is unavailable. Try again before changing its connection.');
      if(!controller.signal.aborted)setCalendarStatus(data);
    } catch {
      if(!controller.signal.aborted)setCalendarError('Calendar status is unavailable. Try again before changing its connection.');
    } finally {if(!controller.signal.aborted)setCalendarLoading(false);}
  }, [currentProperty.id]);

  const [emailLoading,setEmailLoading]=useState(true);
  const [emailError,setEmailError]=useState('');
  const emailRead=useRef<AbortController|null>(null);
  useEffect(()=>()=>emailRead.current?.abort(),[]);
  const loadEmailStatus = useCallback(async () => {
    emailRead.current?.abort();const controller=new AbortController();emailRead.current=controller;
    setEmailLoading(true);setEmailError('');setEmailStatus(null);
    try {
      const res=await fetch(`/api/lumaleasing/email/status?propertyId=${currentProperty.id}`,{signal:controller.signal,cache:'no-store'});
      if(!res.ok)throw new Error('Email status unavailable');
      const data=await res.json();
      if(!controller.signal.aborted)setEmailStatus(data);
    } catch {
      if(!controller.signal.aborted)setEmailError('Email status is unavailable. Retry before changing this connection.');
    } finally {if(!controller.signal.aborted)setEmailLoading(false);}
  }, [currentProperty.id]);

  const loadRecoveryBookings = useCallback(async (cursor:string|null=null) => {
    recoveryRead.current?.abort();const controller=new AbortController();recoveryRead.current=controller;setRecoveryLoading(true);
    try {
      setRecoveryError(null);
      const res = await fetch(`/api/lumaleasing/tours/recovery?propertyId=${currentProperty.id}${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,{signal:controller.signal,cache:'no-store'});
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to load booking recovery data');
      }
      const data = await res.json();
      const bookings = (data.bookings || []) as RecoveryBooking[];
      if(controller.signal.aborted)return;
      setRecoveryBookings(previous=>cursor?[...new Map([...previous,...bookings].map(booking=>[booking.id,booking])).values()]:bookings);
      setRecoveryCursor(data.nextCursor||null);
      setRecoveryDrafts((prev) => {
        const next = { ...prev };
        for (const booking of bookings) {
          if (!next[booking.id]) {
            next[booking.id] = {
              date: booking.scheduled_date,
              time: booking.scheduled_time.slice(0, 5),
            };
          }
        }
        return next;
      });
    } catch (error) {
      if(controller.signal.aborted)return;
      console.error('Failed to load booking recovery data:', error);
      setRecoveryError(error instanceof Error ? error.message : 'Failed to load booking recovery data');
    }finally{if(!controller.signal.aborted)setRecoveryLoading(false)}
  }, [currentProperty.id]);

  useEffect(() => {
    loadConfig();
    loadCalendarStatus();
    loadEmailStatus();
    loadRecoveryBookings();
    
    // Check for OAuth callback success/error in URL params
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const success = params.get('success');
      const error = params.get('error');
      const email = params.get('email');
      
      if ((success === 'calendar_connected' || success === 'calendar_setup_required') && email) {
        alert(success === 'calendar_setup_required' ? `Calendar authorization saved (${email}). Choose the property timezone in Tours to finish setup.` : `Calendar authorization saved (${email}). Review its status in Tours.`);
        loadCalendarStatus();
        // Clean URL
        window.history.replaceState({}, '', window.location.pathname);
      } else if (success === 'email_connected' && email) {
        alert(`Gmail connected successfully! (${email})`);
        loadEmailStatus();
        // Clean URL
        window.history.replaceState({}, '', window.location.pathname);
      } else if (error) {
        alert(`Failed to connect Google Calendar: ${error}`);
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, [loadCalendarStatus, loadConfig, loadEmailStatus, loadRecoveryBookings]);

  const resolveEmailThread = async (threadId: string) => {
    try {
      setResolvingThreadId(threadId);
      const res = await fetch(`/api/lumaleasing/email/threads/${threadId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' }),
      });

      if (!res.ok) {
        const errorPayload = await res.json().catch(() => null);
        throw new Error(errorPayload?.error || 'Failed to resolve thread');
      }

      await loadEmailStatus();
    } catch (error) {
      console.error('Failed to resolve email thread:', error);
      alert(error instanceof Error ? error.message : 'Failed to resolve email thread');
    } finally {
      setResolvingThreadId(null);
    }
  };

  const repairThreadLifecycle = async () => {
    try {
      setRepairingThreads(true);
      const res = await fetch('/api/lumaleasing/email/threads/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: currentProperty.id,
          action: 'resolve_overdue_internal_replies',
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to repair email lifecycle');
      }
      await loadEmailStatus();
      alert(`Lifecycle repair complete. Repaired ${payload?.repaired || 0} overdue threads.`);
    } catch (error) {
      console.error('Failed to repair thread lifecycle:', error);
      alert(error instanceof Error ? error.message : 'Failed to repair thread lifecycle');
    } finally {
      setRepairingThreads(false);
    }
  };

  const repairCalendarSync = async () => {
    try {
      setRepairingCalendarSync(true);
      const res = await fetch('/api/lumaleasing/calendar/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: currentProperty.id }),
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to repair calendar sync');
      }

      await loadCalendarStatus();
      alert(
        `Calendar review ${payload?.success ? 'complete' : 'needs attention'}. Created ${payload?.created || 0}, repaired ${payload?.repaired || 0}, skipped ${payload?.skipped || 0}, failed ${payload?.failed || 0}.`
      );
    } catch (error) {
      console.error('Failed to repair calendar sync:', error);
      alert(error instanceof Error ? error.message : 'Failed to repair calendar sync');
    } finally {
      setRepairingCalendarSync(false);
    }
  };

  const disconnectIntegration = async (kind: 'calendar' | 'email') => {
    const status = kind === 'calendar' ? calendarStatus : emailStatus;
    const account = status?.account_email || status?.email || 'this account';
    if (!confirm(`Remove ${account} from ${kind === 'calendar' ? 'calendar' : 'email'} integration? Linked bookings and mail stay saved; changing to a different account requires review.`)) {
      return;
    }

    const key=JSON.stringify({propertyId:currentProperty.id,kind,provider:kind==='calendar'?calendarStatus?.provider:emailStatus?.provider});
    if(disconnectRequest.current?.key!==key)disconnectRequest.current={key,id:crypto.randomUUID()};
    try {
      setDisconnectingIntegration(kind);
      const res = await fetch(`/api/lumaleasing/${kind}/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: currentProperty.id,
          requestId:disconnectRequest.current.id,
          provider: status?.provider,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || `Failed to disconnect ${kind}`);
      }
      if(!payload?.actionEventId)throw new Error('Disconnection could not be confirmed. Retry the same request.');
      disconnectRequest.current=null;
      if (kind === 'calendar') {
        await loadCalendarStatus();
      } else {
        await loadEmailStatus();
      }
    } catch (error) {
      console.error(`Failed to disconnect ${kind}:`, error);
      alert(error instanceof Error ? error.message : `Failed to disconnect ${kind}`);
    } finally {
      setDisconnectingIntegration(null);
    }
  };

  const runBookingRecovery = async (bookingId: string, action: 'cancel' | 'reschedule') => {
    try {
      setRecoveringBookingId(bookingId);
      setRecoveryError(null);
      const draft = recoveryDrafts[bookingId];
      const body: Record<string, string|number> = {
        expectedVersion:recoveryBookings.find(item=>item.id===bookingId)?.schedule_version || 0,
        reason:draft?.reason?.trim() || '',
        propertyId: currentProperty.id,
        bookingId,
        action,
      };
      if (action === 'reschedule') {
        body.rescheduleDate = draft?.date || '';
        body.rescheduleTime = draft?.time || '';
      }
      const key=JSON.stringify(body);
      if(recoveryRequest.current[bookingId]?.key!==key)recoveryRequest.current[bookingId]={key,id:crypto.randomUUID()};
      body.requestId=recoveryRequest.current[bookingId].id;
      const res = await fetch('/api/lumaleasing/tours/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || 'Recovery action failed');
      }
      await loadRecoveryBookings();
      await loadCalendarStatus();
      alert(
        action === 'cancel'
          ? 'Booking cancelled. Any connected calendar update is queued.'
          : 'Booking rescheduled. Any connected calendar update is queued.'
      );
    } catch (error) {
      console.error('Failed to run booking recovery:', error);
      setRecoveryError(error instanceof Error ? error.message : 'Failed to run booking recovery');
    } finally {
      setRecoveringBookingId(null);
    }
  };

  const saveConfig = async (initialize=false) => {
    if(configWrite.current||(!config&&!initialize)||!revision||saveConflict)return;
    const values=initialize?{}:{...config,timezone:config?.timezone||undefined};
    const body={propertyId:currentProperty.id,expectedRevision:revision,...(!initialize?{config:values}:{})};
    const signature=JSON.stringify(body);
    if(configIdentity.current?.signature!==signature)configIdentity.current={signature,requestId:crypto.randomUUID()};
    const controller=new AbortController();configWrite.current=controller;setSaving(true);setSaveError('');setSaveMessage('');
    try {
      const response=await fetch('/api/lumaleasing/admin/config',{method:initialize?'POST':'PUT',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({...body,requestId:configIdentity.current.requestId})});
      const data=await response.json();
      if(!response.ok){if(!controller.signal.aborted)setSaveConflict(['stale_configuration','request_conflict','already_configured'].includes(data.code));throw new Error(data.error||'The save is unconfirmed. Retry the same change safely.')}
      if(!data.config?.id||!data.actionEventId||!data.revision)throw new Error('The save is unconfirmed. Retry the same change safely.');
      if(!controller.signal.aborted){
        setConfig(editableConfiguration(data.config,data.effectiveTimezone));setRevision(data.revision);setDirty(false);configIdentity.current=null;
        setSaveMessage(data.state==='replayed'?'Save recovered. Current saved settings are shown.':'Settings saved with your action history.');
        void loadCalendarStatus();
      }
    }catch(cause){if(!controller.signal.aborted)setSaveError(cause instanceof Error&&!(cause instanceof TypeError)?cause.message:'The save is unconfirmed. Retry the same change safely.')}
    finally{if(!controller.signal.aborted){configWrite.current=null;setSaving(false)}}
  };

  const updateConfig = <K extends keyof WidgetConfig>(key: K, value: WidgetConfig[K]) => {
    if (!config) return;
    setDirty(true);setSaveMessage('');setConfig({ ...config, [key]: value });
  };

  const updateBusinessHours = (day: string, field: 'start' | 'end', value: string) => {
    if (!config) return;
    const hours = { ...config.business_hours };
    if (hours[day]) {
      hours[day] = { ...hours[day]!, [field]: value };
    }
    setDirty(true);setSaveMessage('');setConfig({ ...config, business_hours: hours });
  };

  const toggleDay = (day: string, enabled: boolean) => {
    if (!config) return;
    const hours = { ...config.business_hours };
    hours[day] = enabled ? { start: '09:00', end: '18:00' } : null;
    setDirty(true);setSaveMessage('');setConfig({ ...config, business_hours: hours });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
      </div>
    );
  }

  if(configError) return <section role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800"><p>{configError}</p><button type="button" onClick={()=>void loadConfig()} className="mt-3 underline">Retry configuration</button></section>;

  if (!config) {
    return (
      <div className="text-center py-12">
        <Sparkles className="w-12 h-12 mx-auto text-gray-300 mb-4" />
        <h3 className="text-lg font-medium text-gray-900">LumaLeasing Not Configured</h3>
        {saveError&&<p role="alert" className="mt-3 text-red-700">{saveError}</p>}
        {saveConflict&&<button type="button" onClick={()=>void loadConfig()} className="mt-3 underline">Load latest settings</button>}
        <p className="text-gray-500 mt-2">Click below to set up LumaLeasing for this property.</p>
        <button
          onClick={()=>void saveConfig(true)}
          disabled={saving||saveConflict||!canManage}
          className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          {saving?'Initializing…':'Initialize LumaLeasing'}
        </button>
      </div>
    );
  }


  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200">
      {/* Header */}
      <div className="p-6 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">LumaLeasing Configuration</h2>
            <p className="text-sm text-slate-500">{currentProperty.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.open(`/lumaleasing/demo?apiKey=${config.api_key}`, '_blank', 'noopener,noreferrer')}
            className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
          >
            <Eye className="w-4 h-4" />
            Preview
          </button>
          <button
            onClick={()=>void saveConfig()}
            disabled={saving||saveConflict||!canManage}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
        </div>
      </div>

      {!canManage&&<p className="mx-6 text-sm text-slate-600">A property manager or administrator can save widget settings.</p>}
      {saveError&&<div role="alert" className="mx-6 rounded-lg bg-red-50 p-3 text-sm text-red-700"><p>{saveError}</p>{saveConflict&&<button type="button" onClick={()=>void loadConfig()} className="mt-2 underline">Load latest settings</button>}</div>}
      {dirty&&<p className="mx-6 text-sm text-amber-700">Unsaved changes</p>}
      {saveMessage&&<p role="status" className="mx-6 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{saveMessage}</p>}
      <p className="mx-6 text-xs text-slate-500">Saving tour settings also updates connected calendars. Previously saved tours keep their recorded timezone.</p>
      {/* Tabs */}
      <div className="border-b border-slate-100">
        <div className="flex">
          {[
            { id: 'branding', label: 'Branding', icon: Palette },
            { id: 'behavior', label: 'Behavior', icon: MessageSquare },
            { id: 'leads', label: 'Lead Capture', icon: UserPlus },
            { id: 'tours', label: 'Tours', icon: Calendar },
            { id: 'embed', label: 'Embed Code', icon: Code },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as typeof activeTab)}
              className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <fieldset disabled={saving} className="min-w-0 p-6">
        {/* Branding Tab */}
        {activeTab === 'branding' && (
          <div className="space-y-6 max-w-2xl">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Widget Name</label>
              <input
                type="text"
                aria-label="Widget name"
                value={config.widget_name}
                onChange={(e) => updateConfig('widget_name', e.target.value)}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
              <p className="text-xs text-slate-500 mt-1">This name appears in the chat header</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Primary Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={config.primary_color}
                    onChange={(e) => updateConfig('primary_color', e.target.value)}
                    className="w-10 h-10 rounded border border-slate-200 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={config.primary_color}
                    onChange={(e) => updateConfig('primary_color', e.target.value)}
                    className="flex-1 px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Secondary Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={config.secondary_color}
                    onChange={(e) => updateConfig('secondary_color', e.target.value)}
                    className="w-10 h-10 rounded border border-slate-200 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={config.secondary_color}
                    onChange={(e) => updateConfig('secondary_color', e.target.value)}
                    className="flex-1 px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Logo</label>
              <div className="flex items-start gap-4">
                <div
                  className="w-16 h-16 flex-shrink-0 rounded-lg flex items-center justify-center overflow-hidden"
                  style={{ background: `linear-gradient(135deg, ${config.primary_color}, ${config.secondary_color})` }}
                >
                  {config.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={config.logo_url}
                      alt="Widget logo preview"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <Sparkles className="w-6 h-6 text-white" />
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="url"
                      value={config.logo_url || ''}
                      onChange={(e) => updateConfig('logo_url', e.target.value || null)}
                      placeholder="https://example.com/logo.png"
                      className="flex-1 px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                  </div>
                  <p className="text-xs text-slate-500">
                    Paste an image URL and save settings, or choose a reviewed library image below.
                  </p>
                </div>
              </div>
            </div>

            <LumaWidgetOperations propertyId={currentProperty.id} mode="logo" settingsDirty={dirty} onStart={()=>setSaveMessage('')} onChanged={async()=>{await loadConfig();setSaveMessage('Widget decision saved with its history.')}}/>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Agent Photo</label>
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 flex-shrink-0 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden">
                  {config.agent_avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={config.agent_avatar_url}
                      alt="Agent photo preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Sparkles className="w-6 h-6 text-slate-400" />
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  <input
                    type="url"
                    value={config.agent_avatar_url || ''}
                    onChange={(e) => updateConfig('agent_avatar_url', e.target.value || null)}
                    placeholder="https://example.com/agent-photo.jpg"
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                  <p className="text-xs text-slate-500">
                    Shown as the assistant&apos;s avatar next to chat replies and on the teaser
                    bubble, giving the widget a human face. Square headshots work best. Leave
                    blank to use the default bot icon.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
              <div>
                <p className="font-medium text-slate-900">Widget Status</p>
                <p className="text-sm text-slate-500">Enable or disable the widget</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.is_active}
                  onChange={(e) => updateConfig('is_active', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>
          </div>
        )}

        {/* Behavior Tab */}
        {activeTab === 'behavior' && (
          <div className="space-y-6 max-w-2xl">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Welcome Message</label>
              <textarea
                value={config.welcome_message}
                onChange={(e) => updateConfig('welcome_message', e.target.value)}
                rows={3}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Offline Message</label>
              <textarea
                value={config.offline_message}
                onChange={(e) => updateConfig('offline_message', e.target.value)}
                rows={2}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
              <p className="text-xs text-slate-500 mt-1">Shown when outside business hours</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Floor Plans Page URL</label>
              <input
                type="url"
                value={config.floor_plans_url || ''}
                onChange={(e) => updateConfig('floor_plans_url', e.target.value || null)}
                placeholder="https://example.com/communities/floor-plans/"
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
              <p className="text-xs text-slate-500 mt-1">The chatbot shares this link when visitors ask about floor plans</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Availability Page URL</label>
              <input
                type="url"
                value={config.availability_url || ''}
                onChange={(e) => updateConfig('availability_url', e.target.value || null)}
                placeholder="https://example.com/communities/site-plan/"
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
              <p className="text-xs text-slate-500 mt-1">The chatbot shares this link when visitors ask about availability</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Teaser Message Delay (seconds)</label>
              <input
                type="number"
                value={config.auto_popup_delay_seconds}
                onChange={(e) => updateConfig('auto_popup_delay_seconds', parseInt(e.target.value) || 0)}
                min={0}
                className="w-32 px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
              <p className="text-xs text-slate-500 mt-1">After this delay, a small message bubble invites the visitor to chat (instead of auto-opening the window). Set to 0 to disable.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Business Hours</label>
              <div className="space-y-2">
                {DAYS.map((day) => (
                  <div key={day} className="flex items-center gap-4">
                    <label className="flex items-center gap-2 w-32">
                      <input
                        type="checkbox"
                        checked={config.business_hours[day] !== null}
                        onChange={(e) => toggleDay(day, e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      <span className="text-sm capitalize">{day}</span>
                    </label>
                    {config.business_hours[day] && (
                      <>
                        <input
                          type="time"
                          value={config.business_hours[day]?.start || '09:00'}
                          onChange={(e) => updateBusinessHours(day, 'start', e.target.value)}
                          className="px-3 py-1 border border-slate-200 rounded text-sm"
                        />
                        <span className="text-slate-500">to</span>
                        <input
                          type="time"
                          value={config.business_hours[day]?.end || '18:00'}
                          onChange={(e) => updateBusinessHours(day, 'end', e.target.value)}
                          className="px-3 py-1 border border-slate-200 rounded text-sm"
                        />
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Timezone</label>
              <select
                aria-label="Scheduling timezone"
                value={config.timezone||''}
                onChange={(e) => updateConfig('timezone', e.target.value)}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              >
                <option value="">Choose property timezone</option>
                {[...new Set([...(config.timezone?[config.timezone]:[]),...TIMEZONES])].map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Leads Tab */}
        {activeTab === 'leads' && (
          <div className="space-y-6 max-w-2xl">
            {/* Gmail Integration Card */}
            <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 rounded-xl p-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  <div className="w-12 h-12 bg-emerald-600 rounded-lg flex items-center justify-center">
                    <Mail className="w-6 h-6 text-white" />
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">Email Inbox Integration</h3>
                  <p className="text-sm text-slate-600 mb-4">
                    Connect Gmail or Outlook to sync inbound lead replies and keep thread lifecycle states visible for leasing follow-up.
                  </p>

                  {emailLoading ? <p role="status" className="text-sm text-slate-600">Loading email connection…</p> : emailError ? <div role="alert" className="text-sm text-red-700"><p>{emailError}</p><button type="button" onClick={()=>void loadEmailStatus()} className="mt-2 underline">Retry email status</button></div> : emailStatus && emailStatus.state !== 'disconnected' ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm bg-white/60 rounded-lg p-3">
                      {emailStatus.state === 'reconnect_required' ? (
                          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                        ) : (
                          <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                        )}
                        <div>
                          <div className="font-medium text-slate-900">{emailStatus.email}</div>
                          <div className="text-xs text-slate-600">
                            Provider:{' '}
                            <span className="font-medium">
                              {emailStatus.provider === 'microsoft' ? 'Outlook Mail' : 'Gmail'}
                            </span>
                            {' '}• Status:{' '}
                            <span className={`font-medium ${
                              emailStatus.token_status === 'healthy' && emailStatus.state === 'connected' ? 'text-green-600' :
                              emailStatus.token_status === 'expiring_soon' ? 'text-yellow-600' :
                              'text-red-600'
                            }`}>
                              {emailStatus.permission_state && emailStatus.permission_state !== 'confirmed' ? 'Permissions need review' : emailStatus.token_status==='refresh_unconfirmed'?'Renewal unconfirmed':emailStatus.token_status==='healthy' && emailStatus.state!=='connected'?'Renewal needed':emailStatus.token_status?.replaceAll('_',' ')}
                            </span>
                            {' '}• Connection:{' '}
                            <span className={`font-medium ${
                              emailStatus.state === 'connected' ? 'text-green-600' : 'text-amber-700'
                            }`}>
                              {emailStatus.state === 'connected' ? 'connected' : 'reconnect required'}
                            </span>
                          </div>
                          {emailStatus.webhook_capability?.mode === 'push_watch' && (
                            <div className="text-xs text-slate-600 mt-1">
                              Webhook:{' '}
                              <span
                                className={`font-medium ${
                                  emailStatus.webhook_capability.ready ? 'text-green-600' : 'text-amber-700'
                                }`}
                              >
                                {emailStatus.webhook_capability.ready ? 'ready' : 'degraded'}
                              </span>
                              {emailStatus.webhook_capability.watch_ttl_minutes !== null && (
                                <span>
                                  {' '}
                                  • watch TTL {emailStatus.webhook_capability.watch_ttl_minutes}m
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-lg bg-white/70 p-3 border border-emerald-100">
                          <p className="text-xs text-slate-500">Awaiting Internal Reply</p>
                          <p className="text-lg font-semibold text-slate-900">
                            {emailStatus.thread_lifecycle?.awaiting_internal_reply || 0}
                          </p>
                        </div>
                        <div className="rounded-lg bg-white/70 p-3 border border-amber-100">
                          <p className="text-xs text-slate-500">Overdue Internal Reply</p>
                          <p className="text-lg font-semibold text-amber-700">
                            {emailStatus.thread_lifecycle?.awaiting_internal_reply_overdue || 0}
                          </p>
                        </div>
                        <div className="rounded-lg bg-white/70 p-3 border border-emerald-100">
                          <p className="text-xs text-slate-500">Awaiting Lead Reply</p>
                          <p className="text-lg font-semibold text-slate-900">
                            {emailStatus.thread_lifecycle?.awaiting_lead_reply || 0}
                          </p>
                        </div>
                      </div>

                      {(emailStatus.pending_threads_preview || []).length > 0 && (
                        <div className="rounded-lg bg-white/70 p-3 border border-emerald-100">
                          <p className="text-xs font-medium text-slate-700 mb-2">Pending Thread Preview</p>
                          <div className="space-y-2">
                            {(emailStatus.pending_threads_preview || []).slice(0, 5).map((thread) => (
                              <div key={thread.id} className="flex items-center justify-between gap-2 p-2 rounded bg-slate-50/80">
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-slate-800 truncate">
                                    {thread.subject || 'No subject'}
                                  </p>
                                  <p className="text-[11px] text-slate-500">
                                    {thread.status || 'unknown'} • {thread.message_count || 0} messages
                                    {thread.overdue && thread.overdue_days
                                      ? ` • overdue ${thread.overdue_days}d`
                                      : ''}
                                  </p>
                                </div>
                                <button
                                  onClick={() => resolveEmailThread(thread.id)}
                                  disabled={resolvingThreadId === thread.id}
                                  className="text-[11px] px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                                >
                                  {resolvingThreadId === thread.id ? 'Resolving...' : 'Resolve'}
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {(emailStatus.thread_lifecycle?.awaiting_internal_reply_overdue || 0) > 0 && (
                        <button
                          onClick={repairThreadLifecycle}
                          disabled={repairingThreads}
                          className="flex items-center gap-2 bg-white text-slate-900 px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors text-sm font-medium disabled:opacity-60"
                        >
                          <Wrench className={`w-4 h-4 ${repairingThreads ? 'animate-spin' : ''}`} />
                          {repairingThreads
                            ? 'Repairing Thread Lifecycle...'
                            : 'Resolve Overdue Internal Replies'}
                        </button>
                      )}

                      {emailStatus.webhook_capability?.mode === 'push_watch' && !emailStatus.webhook_capability.ready && (
                        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          Webhook capability degraded: {emailStatus.webhook_capability.blockers.join(', ')}.
                          Inbound thread updates may be delayed until watch and history cursor are healthy.
                        </div>
                      )}

                      {emailStatus.webhook_capability?.mode === 'manual_check' && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Automatic Outlook notifications are not available. Inbox updates use scheduled checks.</p>}

                      {emailStatus.state === 'reconnect_required' && (
                        <div className="flex items-center gap-3">
                          <AlertCircle className="w-5 h-5 text-amber-600" />
                          <div className="flex-1">
                            <p className="text-sm text-amber-900 font-medium">Action Required</p>
                            <p className="text-xs text-amber-700">{emailStatus.permission_message || emailStatus.message || 'Reconnect this email account to restore access.'}</p>
                          </div>
                          <button
                            onClick={() => window.location.href = `/api/lumaleasing/email/connect?propertyId=${currentProperty.id}&provider=${emailStatus.provider || 'google'}`}
                            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition-colors text-sm font-medium"
                          >
                            <RefreshCw className="w-4 h-4" />
                            Reconnect
                          </button>
                        </div>
                      )}
                      <button
                        onClick={() => disconnectIntegration('email')}
                        disabled={disconnectingIntegration === 'email'}
                        className="flex items-center gap-2 bg-white text-red-700 px-4 py-2 rounded-lg border border-red-200 hover:bg-red-50 transition-colors text-sm font-medium disabled:opacity-60"
                      >
                        <XCircle className="w-4 h-4" />
                        {disconnectingIntegration === 'email' ? 'Removing...' : 'Remove Email Account'}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => window.location.href = `/api/lumaleasing/email/connect?propertyId=${currentProperty.id}&provider=google`}
                        className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition-colors font-medium"
                      >
                        <Mail className="w-4 h-4" />
                        Connect Gmail
                      </button>
                      <button
                        onClick={() => window.location.href = `/api/lumaleasing/email/connect?propertyId=${currentProperty.id}&provider=microsoft`}
                        className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors font-medium"
                      >
                        <Mail className="w-4 h-4" />
                        Connect Outlook
                      </button>
                    </div>
                  )}
                  <IntegrationReplacementPanel key={`replacement-${currentProperty.id}`} propertyId={currentProperty.id} defaultCapability="email"/>
                  <IntegrationInvitesPanel key={currentProperty.id} propertyId={currentProperty.id} defaultCapability="email"/>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Lead Capture Prompt</label>
              <textarea
                value={config.lead_capture_prompt}
                onChange={(e) => updateConfig('lead_capture_prompt', e.target.value)}
                rows={2}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>

            <div className="space-y-4">
              <p className="text-sm font-medium text-slate-700">Collect Information</p>
              
              {[
                { key: 'collect_name' as const, label: 'Name' },
                { key: 'collect_email' as const, label: 'Email Address' },
                { key: 'collect_phone' as const, label: 'Phone Number' },
              ].map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                  <span className="text-slate-700">{label}</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config[key]}
                      onChange={(e) => updateConfig(key, e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>
              ))}

              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                <div>
                  <p className="text-slate-700">Require Email Before Chat</p>
                  <p className="text-xs text-slate-500">User must provide email to start chatting</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.require_email_before_chat}
                    onChange={(e) => updateConfig('require_email_before_chat', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Tours Tab */}
        {activeTab === 'tours' && (
          <div className="space-y-6 max-w-2xl">
            {/* Google Calendar Integration Card */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-indigo-100 rounded-xl p-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  <div className="w-12 h-12 bg-indigo-600 rounded-lg flex items-center justify-center">
                    <Calendar className="w-6 h-6 text-white" />
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">Calendar Integration</h3>
                  <p className="text-sm text-slate-600 mb-4">
                    Connect Google Calendar or Outlook Calendar to show real-time availability in the widget.
                    Tours will automatically appear in your calendar.
                  </p>
                  
                  {calendarLoading ? <p role="status" className="text-sm text-slate-600">Loading calendar status…</p> : calendarError ? <div role="alert" className="text-sm text-red-700"><p>{calendarError}</p><button type="button" onClick={()=>void loadCalendarStatus()} className="mt-2 underline">Retry calendar status</button></div> : calendarStatus && calendarStatus.state !== 'disconnected' ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm bg-white/50 rounded-lg p-3">
                        {calendarStatus.state !== 'connected' ? (
                          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                        ) : (
                          <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                        )}
                        <div>
                          <div className="font-medium text-slate-900">{calendarStatus.email}</div>
                          <div className="text-xs text-slate-600">
                            Provider:{' '}
                            <span className="font-medium">
                              {calendarStatus.provider === 'microsoft' ? 'Outlook Calendar' : 'Google Calendar'}
                            </span>
                            {' '}• Status: <span className={`font-medium ${
                              calendarStatus.token_status === 'healthy' && calendarStatus.state === 'connected' ? 'text-green-600' :
                              calendarStatus.token_status === 'expiring_soon' ? 'text-yellow-600' :
                              'text-red-600'
                            }`}>{calendarStatus.permission_state && calendarStatus.permission_state !== 'confirmed' ? 'Permissions need review' : calendarStatus.token_status==='refresh_unconfirmed'?'Renewal unconfirmed':calendarStatus.token_status?.replaceAll('_',' ')}</span>
                            {' '}• Connection:{' '}
                            <span className={`font-medium ${
                              calendarStatus.state === 'connected' ? 'text-green-600' : 'text-amber-700'
                            }`}>
                              {calendarStatus.state === 'connected' ? 'connected' : calendarStatus.state === 'setup_required' ? 'timezone setup required' : 'reconnect required'}
                            </span>
                            {calendarStatus.last_health_check_at && (
                              <span> • Last checked: {new Date(calendarStatus.last_health_check_at).toLocaleString()}</span>
                            )}
                          </div>
                          {calendarStatus.webhook_capability?.mode === 'push_watch' && (
                            <div className="text-xs text-slate-600 mt-1">
                              Webhook:{' '}
                              <span
                                className={`font-medium ${
                                  calendarStatus.webhook_capability.ready ? 'text-green-600' : 'text-amber-700'
                                }`}
                              >
                                {calendarStatus.webhook_capability.ready ? 'ready' : 'degraded'}
                              </span>
                              {calendarStatus.webhook_capability.watch_ttl_minutes !== null && (
                                <span>
                                  {' '}
                                  • watch TTL {calendarStatus.webhook_capability.watch_ttl_minutes}m
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      {calendarStatus.timezone && <p className="text-sm text-slate-700">Tour timezone: {calendarStatus.timezone}</p>}
                      {calendarStatus.timezone_setup_required && <PropertyTimezoneSetup key={currentProperty.id} propertyId={currentProperty.id} onSaved={() => void loadCalendarStatus()}/>}
                      {calendarStatus.calendar_sync && (
                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-lg bg-white/70 p-3 border border-indigo-100">
                            <p className="text-xs text-slate-500">Synced Calendar Events</p>
                            <p className="text-lg font-semibold text-slate-900">
                              {calendarStatus.calendar_sync.synced_events}
                            </p>
                          </div>
                          <div className="rounded-lg bg-white/70 p-3 border border-indigo-100">
                            <p className="text-xs text-slate-500">Sync Issues</p>
                            <p className={`text-lg font-semibold ${
                              calendarStatus.calendar_sync.degraded ? 'text-amber-700' : 'text-slate-900'
                            }`}>
                              {calendarStatus.calendar_sync.failed_events +
                                calendarStatus.calendar_sync.external_drift_events +
                                calendarStatus.calendar_sync.external_missing_events +
                                calendarStatus.calendar_sync.external_cancelled_events +
                                calendarStatus.calendar_sync.missing_event_bookings}
                            </p>
                          </div>
                        </div>
                      )}
                      {calendarStatus.state === 'reconnect_required' && (
                        <div className="flex items-center gap-3">
                          <AlertCircle className="w-5 h-5 text-amber-600" />
                          <div className="flex-1">
                            <p className="text-sm text-amber-900 font-medium">Action Required</p>
                            <p className="text-xs text-amber-700">{calendarStatus.permission_message || 'Your calendar needs to be reconnected'}</p>
                          </div>
                          <button
                            onClick={() => window.location.href = `/api/lumaleasing/calendar/connect?propertyId=${currentProperty.id}&provider=${calendarStatus.provider || 'google'}`}
                            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
                          >
                            <RefreshCw className="w-4 h-4" />
                            Reconnect
                          </button>
                        </div>
                      )}
                      <button
                        onClick={() => disconnectIntegration('calendar')}
                        disabled={disconnectingIntegration === 'calendar'}
                        className="flex items-center gap-2 bg-white text-red-700 px-4 py-2 rounded-lg border border-red-200 hover:bg-red-50 transition-colors text-sm font-medium disabled:opacity-60"
                      >
                        <XCircle className="w-4 h-4" />
                        {disconnectingIntegration === 'calendar' ? 'Removing...' : 'Remove Calendar Account'}
                      </button>
                      {calendarStatus.webhook_capability?.mode === 'push_watch' && !calendarStatus.webhook_capability.ready && (
                        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          Automatic calendar updates need attention. Changes made in Google Calendar may not appear here until the connection is restored and checked again.
                        </div>
                      )}
                      {calendarStatus.webhook_capability?.mode === 'manual_check' && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Automatic Outlook updates are not available. Check affected bookings after making changes in Outlook.</p>}
                      {calendarStatus.calendar_sync?.degraded && (
                        <div className="space-y-3">
                          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                            Review the calendar connection and affected bookings before relying on availability. Calendar health or booking changes need attention.
                          </div>
                          {calendarStatus.state === 'connected' && (
                            <button
                              onClick={repairCalendarSync}
                              disabled={repairingCalendarSync}
                              className="flex items-center gap-2 bg-white text-slate-900 px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors text-sm font-medium disabled:opacity-60"
                            >
                              <RefreshCw className={`w-4 h-4 ${repairingCalendarSync ? 'animate-spin' : ''}`} />
                              {repairingCalendarSync ? 'Repairing Calendar Sync...' : 'Repair Calendar Sync'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => window.location.href = `/api/lumaleasing/calendar/connect?propertyId=${currentProperty.id}&provider=google`}
                        className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors font-medium"
                      >
                        <Calendar className="w-4 h-4" />
                        Connect Google Calendar
                      </button>
                      <button
                        onClick={() => window.location.href = `/api/lumaleasing/calendar/connect?propertyId=${currentProperty.id}&provider=microsoft`}
                        className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition-colors font-medium"
                      >
                        <Calendar className="w-4 h-4" />
                        Connect Outlook Calendar
                      </button>
                    </div>
                  )}
                  <IntegrationReplacementPanel key={`replacement-${currentProperty.id}`} propertyId={currentProperty.id} defaultCapability="calendar"/>
                  <IntegrationInvitesPanel key={currentProperty.id} propertyId={currentProperty.id} defaultCapability="calendar"/>
                  
                  {!calendarLoading&&!calendarError&&!calendarStatus?.connected && (
                    <p className="text-xs text-slate-500 mt-3">
                      💡 Without calendar integration, tour availability will be based on static time slots.
                      Connect your calendar for real-time availability.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">Booking Recovery</h4>
                  <p className="text-xs text-slate-600">
                    Recover from booking issues with operator-triggered reschedule and cancel actions.
                  </p>
                </div>
                <button
                  onClick={()=>void loadRecoveryBookings()}
                  disabled={recoveringBookingId !== null||recoveryLoading}
                  className="text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-white disabled:opacity-60"
                >
                  Refresh
                </button>
              </div>

              {calendarReviewMessage&&<p role="status" className="mb-3 text-sm text-emerald-800">{calendarReviewMessage}</p>}
              {recoveryError && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-3">
                  {recoveryError}
                </div>
              )}

              {recoveryLoading&&<p role="status" className="mb-3 text-sm text-slate-500">Loading bookings…</p>}
              {!recoveryLoading&&!recoveryError&&recoveryBookings.length === 0 ? (
                <p className="text-xs text-slate-500">No bookings available for recovery actions.</p>
              ) : (
                <div className="space-y-3">
                  {recoveryBookings.map((booking) => (
                    <div key={booking.id} className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-900">
                            {booking.lead?.name || 'Unknown lead'} • {booking.scheduled_date} {booking.scheduled_time.slice(0, 5)} {booking.schedule_timezone||'(timezone not confirmed)'}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            Status: {booking.status || 'unknown'} • Calendar:{' '}
                            {({external_drift:'Time changed — review needed',external_missing:'Event missing — review needed',external_cancelled:'Cancelled — review needed',synced:'Up to date',pending:'Update pending'} as Record<string,string>)[booking.calendar_event?.sync_status||''] || 'Not confirmed'}
                          </p>
                        </div>
                        <span className="text-[11px] text-slate-500 font-mono">{booking.id.slice(0, 8)}</span>
                      </div>

                      {booking.calendar_event?.sync_status?.startsWith('external_')?<CalendarChangeReview
                        key={booking.id} propertyId={currentProperty.id} bookingId={booking.id}
                        version={booking.schedule_version} timezone={booking.schedule_timezone} durationMinutes={booking.duration_minutes || 30} observation={booking.calendar_event}
                        onUpdated={async message=>{setCalendarReviewMessage(message);await loadRecoveryBookings();await loadCalendarStatus();}}/>:<>
                      {!booking.calendar_event && <CalendarEventBinding key={`${booking.id}/${booking.schedule_version}`} propertyId={currentProperty.id} bookingId={booking.id} version={booking.schedule_version} timezone={booking.schedule_timezone} onUpdated={async message=>{setCalendarReviewMessage(message);await loadRecoveryBookings();await loadCalendarStatus();}}/>}
                      <div className="grid grid-cols-2 gap-2 mt-3">
                        <input
                          type="date"
                          value={recoveryDrafts[booking.id]?.date || ''}
                          onChange={(e) =>
                            setRecoveryDrafts((prev) => ({
                              ...prev,
                              [booking.id]: {
                                ...prev[booking.id],
                                date: e.target.value,
                                time: prev[booking.id]?.time || booking.scheduled_time.slice(0, 5),
                              },
                            }))
                          }
                          className="px-2 py-1.5 border border-slate-200 rounded text-xs"
                        />
                        <input
                          type="time"
                          value={recoveryDrafts[booking.id]?.time || ''}
                          onChange={(e) =>
                            setRecoveryDrafts((prev) => ({
                              ...prev,
                              [booking.id]: {
                                ...prev[booking.id],
                                date: prev[booking.id]?.date || booking.scheduled_date,
                                time: e.target.value,
                              },
                            }))
                          }
                          className="px-2 py-1.5 border border-slate-200 rounded text-xs"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2 mt-3">
                        <label className="w-full text-sm text-slate-700">Reason for change
                          <input aria-label={`Reason for ${booking.lead?.name || 'tour'} change`} value={recoveryDrafts[booking.id]?.reason || ''} maxLength={2000}
                            onChange={e=>setRecoveryDrafts(previous=>({...previous,[booking.id]:{...previous[booking.id],reason:e.target.value}}))}
                            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"/>
                        </label>
                        <button
                          onClick={() => runBookingRecovery(booking.id, 'reschedule')}
                          disabled={!booking.can_reschedule || recoveringBookingId === booking.id || !recoveryDrafts[booking.id]?.reason?.trim()}
                          className="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          {recoveringBookingId === booking.id ? 'Working...' : 'Reschedule'}
                        </button>
                        <button
                          onClick={() => runBookingRecovery(booking.id, 'cancel')}
                          disabled={!booking.can_cancel || recoveringBookingId === booking.id || !recoveryDrafts[booking.id]?.reason?.trim()}
                          className="text-xs px-3 py-1.5 rounded bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50 flex items-center gap-1"
                        >
                          <XCircle className="w-3 h-3" />
                          Cancel
                        </button>
                      </div>
                      </>}
                    </div>
                  ))}
                </div>
              )}
              {recoveryCursor&&<button disabled={recoveryLoading} onClick={()=>void loadRecoveryBookings(recoveryCursor)} className="mt-3 rounded border bg-white px-3 py-2 text-sm disabled:opacity-50">Load more bookings</button>}
            </div>

            {/* Tour Settings */}
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
              <div>
                <p className="font-medium text-slate-900">Enable Tour Booking</p>
                <p className="text-sm text-slate-500">Allow visitors to schedule tours via chat</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.tours_enabled}
                  onChange={(e) => updateConfig('tours_enabled', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>

            {config.tours_enabled && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Tour Duration (minutes)</label>
                    <input
                      type="number"
                      value={config.tour_duration_minutes}
                      onChange={(e) => updateConfig('tour_duration_minutes', parseInt(e.target.value) || 30)}
                      min={15}
                      step={15}
                      className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Buffer Between Tours (minutes)</label>
                    <input
                      type="number"
                      value={config.tour_buffer_minutes}
                      onChange={(e) => updateConfig('tour_buffer_minutes', parseInt(e.target.value) || 15)}
                      min={0}
                      step={5}
                      className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-sm text-amber-800">
                    <strong>Note:</strong> Tour slots are generated based on your business hours settings. 
                    Use the Tour Management page to customize specific availability.
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {/* Embed Tab */}
        {activeTab === 'embed' && <LumaWidgetOperations propertyId={currentProperty.id} mode="installation" settingsDirty={dirty} onStart={()=>setSaveMessage('')} onChanged={async()=>{await loadConfig();setSaveMessage('Widget decision saved with its history.')}}/>}

      </fieldset>
    </div>
  );
}

export default LumaLeasingConfig;

