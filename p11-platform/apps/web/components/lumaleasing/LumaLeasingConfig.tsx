'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Save, Copy, Check, RefreshCw, Eye, Palette, MessageSquare, 
  UserPlus, Calendar, Code, ExternalLink, Loader2,
  Sparkles, CheckCircle, AlertCircle, Mail, XCircle, Wrench, Upload
} from 'lucide-react';
import { usePropertyContext } from '../layout/PropertyContext';

interface WidgetConfig {
  id: string;
  property_id: string;
  widget_name: string;
  primary_color: string;
  secondary_color: string;
  logo_url: string | null;
  welcome_message: string;
  offline_message: string;
  auto_popup_delay_seconds: number;
  require_email_before_chat: boolean;
  collect_name: boolean;
  collect_email: boolean;
  collect_phone: boolean;
  lead_capture_prompt: string;
  tours_enabled: boolean;
  tour_duration_minutes: number;
  tour_buffer_minutes: number;
  business_hours: Record<string, { start: string; end: string } | null>;
  timezone: string;
  api_key: string;
  is_active: boolean;
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

interface RecoveryBooking {
  id: string;
  lead: { name: string; email: string | null; phone: string | null } | null;
  scheduled_date: string;
  scheduled_time: string;
  duration_minutes: number | null;
  status: string | null;
  can_cancel: boolean;
  can_reschedule: boolean;
  calendar_event: { id: string; google_event_id: string; sync_status: string | null } | null;
}

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
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'branding' | 'behavior' | 'leads' | 'tours' | 'embed'>('branding');
  const [calendarStatus, setCalendarStatus] = useState<{
    connected: boolean;
    state?: 'connected' | 'reconnect_required' | 'disconnected';
    provider?: 'google' | 'microsoft';
    email?: string;
    account_email?: string;
    token_status?: string;
    last_health_check_at?: string;
    webhook_capability?: {
      mode: 'push_watch' | 'unconfigured';
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
    auto_reply_enabled?: boolean;
    webhook_capability?: {
      mode: 'push_watch' | 'unconfigured';
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
  const [recoveryDrafts, setRecoveryDrafts] = useState<Record<string, { date: string; time: string }>>({});
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [creatingInvite, setCreatingInvite] = useState<string | null>(null);
  const [disconnectingIntegration, setDisconnectingIntegration] = useState<'calendar' | 'email' | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/lumaleasing/admin/config?propertyId=${currentProperty.id}`);
      const data = await res.json();
      setConfig(data.config);
    } catch (error) {
      console.error('Failed to load config:', error);
    } finally {
      setLoading(false);
    }
  }, [currentProperty.id]);

  const loadCalendarStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/lumaleasing/calendar/status?propertyId=${currentProperty.id}`);
      if (res.ok) {
        const data = await res.json();
        setCalendarStatus(data);
      }
    } catch (error) {
      console.error('Failed to load calendar status:', error);
    }
  }, [currentProperty.id]);

  const loadEmailStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/lumaleasing/email/status?propertyId=${currentProperty.id}`);
      if (res.ok) {
        const data = await res.json();
        setEmailStatus(data);
      }
    } catch (error) {
      console.error('Failed to load email status:', error);
    }
  }, [currentProperty.id]);

  const loadRecoveryBookings = useCallback(async () => {
    try {
      setRecoveryError(null);
      const res = await fetch(`/api/lumaleasing/tours/recovery?propertyId=${currentProperty.id}`);
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to load booking recovery data');
      }
      const data = await res.json();
      const bookings = (data.bookings || []) as RecoveryBooking[];
      setRecoveryBookings(bookings);
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
      console.error('Failed to load booking recovery data:', error);
      setRecoveryError(error instanceof Error ? error.message : 'Failed to load booking recovery data');
    }
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
      
      if (success === 'calendar_connected' && email) {
        alert(`Google Calendar connected successfully! (${email})`);
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
        `Calendar repair complete. Created ${payload?.created || 0}, repaired ${payload?.repaired || 0}, failed ${payload?.failed || 0}.`
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
    if (!confirm(`Remove ${account} from ${kind === 'calendar' ? 'calendar' : 'email'} integration? You can reconnect a new account afterward.`)) {
      return;
    }

    try {
      setDisconnectingIntegration(kind);
      const res = await fetch(`/api/lumaleasing/${kind}/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: currentProperty.id,
          provider: status?.provider,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || `Failed to disconnect ${kind}`);
      }
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
      const body: Record<string, string> = {
        propertyId: currentProperty.id,
        bookingId,
        action,
      };
      if (action === 'reschedule') {
        body.rescheduleDate = draft?.date || '';
        body.rescheduleTime = draft?.time || '';
      }
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
          ? 'Booking cancelled successfully.'
          : 'Booking rescheduled successfully.'
      );
    } catch (error) {
      console.error('Failed to run booking recovery:', error);
      setRecoveryError(error instanceof Error ? error.message : 'Failed to run booking recovery');
    } finally {
      setRecoveringBookingId(null);
    }
  };

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await fetch('/api/lumaleasing/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: currentProperty.id, config }),
      });
    } catch (error) {
      console.error('Failed to save config:', error);
    } finally {
      setSaving(false);
    }
  };

  const regenerateApiKey = async () => {
    if (!confirm('Are you sure? This will invalidate any existing widget installations.')) return;
    try {
      const res = await fetch('/api/lumaleasing/admin/regenerate-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: currentProperty.id }),
      });
      const data = await res.json();
      if (data.apiKey && config) {
        setConfig({ ...config, api_key: data.apiKey });
      }
    } catch (error) {
      console.error('Failed to regenerate key:', error);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const createExternalAuthLink = async (
    provider: 'google' | 'microsoft',
    capability: 'calendar' | 'email'
  ) => {
    try {
      setCreatingInvite(`${provider}-${capability}`);
      const res = await fetch('/api/lumaleasing/integration-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: currentProperty.id,
          provider,
          capabilities: [capability],
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.url) {
        throw new Error(payload?.error || 'Failed to create authorization link');
      }
      copyToClipboard(payload.url);
      alert(`${provider === 'google' ? 'Google' : 'Microsoft'} ${capability} authorization link copied.`);
    } catch (error) {
      console.error('Failed to create external auth link:', error);
      alert(error instanceof Error ? error.message : 'Failed to create authorization link');
    } finally {
      setCreatingInvite(null);
    }
  };

  const updateConfig = <K extends keyof WidgetConfig>(key: K, value: WidgetConfig[K]) => {
    if (!config) return;
    setConfig({ ...config, [key]: value });
  };

  const uploadLogo = async (file: File) => {
    setLogoUploadError(null);

    if (!file.type.startsWith('image/')) {
      setLogoUploadError('Please choose an image file (PNG, JPG, GIF, WebP, or SVG).');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setLogoUploadError('Logo must be 2MB or smaller.');
      return;
    }

    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('propertyId', currentProperty.id);
      formData.append('file', file);

      const res = await fetch('/api/lumaleasing/admin/logo', {
        method: 'POST',
        body: formData,
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.url) {
        throw new Error(payload?.error || 'Failed to upload logo');
      }

      setConfig((prev) => (prev ? { ...prev, logo_url: payload.url } : prev));
    } catch (error) {
      console.error('Failed to upload logo:', error);
      setLogoUploadError(error instanceof Error ? error.message : 'Failed to upload logo');
    } finally {
      setUploadingLogo(false);
      if (logoFileInputRef.current) {
        logoFileInputRef.current.value = '';
      }
    }
  };

  const updateBusinessHours = (day: string, field: 'start' | 'end', value: string) => {
    if (!config) return;
    const hours = { ...config.business_hours };
    if (hours[day]) {
      hours[day] = { ...hours[day]!, [field]: value };
    }
    setConfig({ ...config, business_hours: hours });
  };

  const toggleDay = (day: string, enabled: boolean) => {
    if (!config) return;
    const hours = { ...config.business_hours };
    hours[day] = enabled ? { start: '09:00', end: '18:00' } : null;
    setConfig({ ...config, business_hours: hours });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="text-center py-12">
        <Sparkles className="w-12 h-12 mx-auto text-gray-300 mb-4" />
        <h3 className="text-lg font-medium text-gray-900">LumaLeasing Not Configured</h3>
        <p className="text-gray-500 mt-2">Click below to set up LumaLeasing for this property.</p>
        <button
          onClick={loadConfig}
          className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          Initialize LumaLeasing
        </button>
      </div>
    );
  }

  const embedCode = `<!-- LumaLeasing Widget -->
<script>
  (function(w,d,s,o,f,js,fjs){
    w['LumaLeasing']=o;w[o]=w[o]||function(){(w[o].q=w[o].q||[]).push(arguments)};
    js=d.createElement(s);fjs=d.getElementsByTagName(s)[0];
    js.id=o;js.src=f;js.async=1;fjs.parentNode.insertBefore(js,fjs);
  }(window,document,'script','lumaleasing','${typeof window !== 'undefined' ? window.location.origin : ''}/lumaleasing.js'));
  lumaleasing('init', '${config.api_key}');
</script>`;

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
            onClick={saveConfig}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
        </div>
      </div>

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
      <div className="p-6">
        {/* Branding Tab */}
        {activeTab === 'branding' && (
          <div className="space-y-6 max-w-2xl">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Widget Name</label>
              <input
                type="text"
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
                    <button
                      type="button"
                      onClick={() => logoFileInputRef.current?.click()}
                      disabled={uploadingLogo}
                      className="flex items-center gap-2 px-4 py-2 bg-white text-slate-700 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-sm font-medium whitespace-nowrap"
                    >
                      {uploadingLogo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      {uploadingLogo ? 'Uploading...' : 'Upload Image'}
                    </button>
                    <input
                      ref={logoFileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadLogo(file);
                      }}
                    />
                  </div>
                  {logoUploadError && (
                    <p className="text-xs text-red-600">{logoUploadError}</p>
                  )}
                  <p className="text-xs text-slate-500">
                    Paste an image URL or upload a file (PNG, JPG, GIF, WebP, or SVG, max 2MB).
                    A square image with a transparent background works best — it is shown
                    directly on the chat header colors. Remember to click Save Changes after uploading.
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
              <label className="block text-sm font-medium text-slate-700 mb-2">Auto-popup Delay (seconds)</label>
              <input
                type="number"
                value={config.auto_popup_delay_seconds}
                onChange={(e) => updateConfig('auto_popup_delay_seconds', parseInt(e.target.value) || 0)}
                min={0}
                className="w-32 px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
              <p className="text-xs text-slate-500 mt-1">Set to 0 to disable auto-popup</p>
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
                value={config.timezone}
                onChange={(e) => updateConfig('timezone', e.target.value)}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              >
                {TIMEZONES.map((tz) => (
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

                  {emailStatus && emailStatus.state !== 'disconnected' ? (
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
                              emailStatus.token_status === 'healthy' ? 'text-green-600' :
                              emailStatus.token_status === 'expiring_soon' ? 'text-yellow-600' :
                              'text-red-600'
                            }`}>
                              {emailStatus.token_status}
                            </span>
                            {' '}• Connection:{' '}
                            <span className={`font-medium ${
                              emailStatus.state === 'connected' ? 'text-green-600' : 'text-amber-700'
                            }`}>
                              {emailStatus.state === 'connected' ? 'connected' : 'reconnect required'}
                            </span>
                          </div>
                          {emailStatus.webhook_capability && (
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

                      {emailStatus.webhook_capability && !emailStatus.webhook_capability.ready && (
                        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          Webhook capability degraded: {emailStatus.webhook_capability.blockers.join(', ')}.
                          Inbound thread updates may be delayed until watch and history cursor are healthy.
                        </div>
                      )}

                      {emailStatus.state === 'reconnect_required' && (
                        <div className="flex items-center gap-3">
                          <AlertCircle className="w-5 h-5 text-amber-600" />
                          <div className="flex-1">
                            <p className="text-sm text-amber-900 font-medium">Action Required</p>
                            <p className="text-xs text-amber-700">Your Gmail connection needs to be refreshed</p>
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
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button
                      onClick={() => createExternalAuthLink('google', 'email')}
                      disabled={creatingInvite === 'google-email'}
                      className="flex items-center gap-2 bg-white text-slate-900 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors text-xs font-medium disabled:opacity-60"
                    >
                      <Copy className="w-3 h-3" />
                      {creatingInvite === 'google-email' ? 'Creating...' : 'Copy Gmail Auth Link'}
                    </button>
                    <button
                      onClick={() => createExternalAuthLink('microsoft', 'email')}
                      disabled={creatingInvite === 'microsoft-email'}
                      className="flex items-center gap-2 bg-white text-slate-900 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors text-xs font-medium disabled:opacity-60"
                    >
                      <Copy className="w-3 h-3" />
                      {creatingInvite === 'microsoft-email' ? 'Creating...' : 'Copy Outlook Auth Link'}
                    </button>
                  </div>
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
                  
                  {calendarStatus && calendarStatus.state !== 'disconnected' ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm bg-white/50 rounded-lg p-3">
                        {calendarStatus.state === 'reconnect_required' ? (
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
                              calendarStatus.token_status === 'healthy' ? 'text-green-600' :
                              calendarStatus.token_status === 'expiring_soon' ? 'text-yellow-600' :
                              'text-red-600'
                            }`}>{calendarStatus.token_status}</span>
                            {' '}• Connection:{' '}
                            <span className={`font-medium ${
                              calendarStatus.state === 'connected' ? 'text-green-600' : 'text-amber-700'
                            }`}>
                              {calendarStatus.state === 'connected' ? 'connected' : 'reconnect required'}
                            </span>
                            {calendarStatus.last_health_check_at && (
                              <span> • Last checked: {new Date(calendarStatus.last_health_check_at).toLocaleString()}</span>
                            )}
                          </div>
                          {calendarStatus.webhook_capability && (
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
                            <p className="text-xs text-amber-700">Your calendar needs to be reconnected</p>
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
                      {calendarStatus.webhook_capability && !calendarStatus.webhook_capability.ready && (
                        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          Calendar webhook degraded: {calendarStatus.webhook_capability.blockers.join(', ')}.
                          External Google Calendar edits may not propagate until watch health is restored.
                        </div>
                      )}
                      {calendarStatus.calendar_sync?.degraded && (
                        <div className="space-y-3">
                          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                            Some bookings are not fully synced to Google Calendar yet, or the linked Google events were changed outside P11. New bookings still work, but operator follow-up may be required.
                          </div>
                          {calendarStatus.token_status === 'healthy' && (
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
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button
                      onClick={() => createExternalAuthLink('google', 'calendar')}
                      disabled={creatingInvite === 'google-calendar'}
                      className="flex items-center gap-2 bg-white text-slate-900 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors text-xs font-medium disabled:opacity-60"
                    >
                      <Copy className="w-3 h-3" />
                      {creatingInvite === 'google-calendar' ? 'Creating...' : 'Copy Google Calendar Link'}
                    </button>
                    <button
                      onClick={() => createExternalAuthLink('microsoft', 'calendar')}
                      disabled={creatingInvite === 'microsoft-calendar'}
                      className="flex items-center gap-2 bg-white text-slate-900 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors text-xs font-medium disabled:opacity-60"
                    >
                      <Copy className="w-3 h-3" />
                      {creatingInvite === 'microsoft-calendar' ? 'Creating...' : 'Copy Outlook Calendar Link'}
                    </button>
                  </div>
                  
                  {!calendarStatus?.connected && (
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
                  onClick={loadRecoveryBookings}
                  disabled={recoveringBookingId !== null}
                  className="text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-white disabled:opacity-60"
                >
                  Refresh
                </button>
              </div>

              {recoveryError && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-3">
                  {recoveryError}
                </div>
              )}

              {recoveryBookings.length === 0 ? (
                <p className="text-xs text-slate-500">No bookings available for recovery actions.</p>
              ) : (
                <div className="space-y-3">
                  {recoveryBookings.slice(0, 8).map((booking) => (
                    <div key={booking.id} className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-900">
                            {booking.lead?.name || 'Unknown lead'} • {booking.scheduled_date} {booking.scheduled_time.slice(0, 5)}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            Status: {booking.status || 'unknown'} • Calendar:{' '}
                            {booking.calendar_event?.sync_status || 'not_synced'}
                          </p>
                        </div>
                        <span className="text-[11px] text-slate-500 font-mono">{booking.id.slice(0, 8)}</span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 mt-3">
                        <input
                          type="date"
                          value={recoveryDrafts[booking.id]?.date || ''}
                          onChange={(e) =>
                            setRecoveryDrafts((prev) => ({
                              ...prev,
                              [booking.id]: {
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
                                date: prev[booking.id]?.date || booking.scheduled_date,
                                time: e.target.value,
                              },
                            }))
                          }
                          className="px-2 py-1.5 border border-slate-200 rounded text-xs"
                        />
                      </div>

                      <div className="flex items-center gap-2 mt-3">
                        <button
                          onClick={() => runBookingRecovery(booking.id, 'reschedule')}
                          disabled={!booking.can_reschedule || recoveringBookingId === booking.id}
                          className="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          {recoveringBookingId === booking.id ? 'Working...' : 'Reschedule'}
                        </button>
                        <button
                          onClick={() => runBookingRecovery(booking.id, 'cancel')}
                          disabled={!booking.can_cancel || recoveringBookingId === booking.id}
                          className="text-xs px-3 py-1.5 rounded bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50 flex items-center gap-1"
                        >
                          <XCircle className="w-3 h-3" />
                          Cancel
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
        {activeTab === 'embed' && (
          <div className="space-y-6">
            <div className="p-4 bg-slate-50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-slate-700">API Key</label>
                <button
                  onClick={regenerateApiKey}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-red-600"
                >
                  <RefreshCw className="w-3 h-3" />
                  Regenerate
                </button>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded text-sm font-mono">
                  {config.api_key}
                </code>
                <button
                  onClick={() => copyToClipboard(config.api_key)}
                  className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-white rounded"
                >
                  {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-slate-700">Embed Code</label>
                <button
                  onClick={() => copyToClipboard(embedCode)}
                  className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700"
                >
                  <Copy className="w-3 h-3" />
                  Copy Code
                </button>
              </div>
              <pre className="p-4 bg-slate-900 text-slate-100 rounded-lg overflow-x-auto text-sm">
                <code>{embedCode}</code>
              </pre>
              <p className="text-xs text-slate-500 mt-2">
                Paste this code before the closing &lt;/body&gt; tag on your website.
              </p>
            </div>

            <div className="flex items-center gap-4 p-4 bg-indigo-50 rounded-lg">
              <ExternalLink className="w-5 h-5 text-indigo-600" />
              <div className="flex-1">
                <p className="font-medium text-indigo-900">Test Your Widget</p>
                <p className="text-sm text-indigo-700">Preview how the widget looks on a test page</p>
              </div>
              <a
                href={`/lumaleasing/demo?apiKey=${config.api_key}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"
              >
                Open Demo
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default LumaLeasingConfig;

