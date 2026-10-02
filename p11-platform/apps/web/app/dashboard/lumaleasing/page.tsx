'use client';
import {LumaConversationInbox} from '@/components/lumaleasing/LumaConversationInbox';

import {IntegrationReplacementPanel} from '@/components/lumaleasing/IntegrationReplacementPanel';
import {IntegrationInvitesPanel} from '@/components/lumaleasing/IntegrationInvitesPanel';
import {integrationFailureMessage} from '@/utils/services/integration-result-message';
import { usePropertyContext } from '@/components/layout/PropertyContext';
import { LumaLeasingConfig } from '@/components/lumaleasing/LumaLeasingConfig';
import {RequestEvidence}from '@/components/lumaleasing/RequestEvidence';
import { ReliabilityPanel } from '@/components/operations/ReliabilityPanel';
import {
ArrowUpRight,
Bot,
Calendar,
CheckCircle,
Clock,
Eye,
Link,
Mail,
MessageSquare,
Settings,
Sparkles,
TrendingUp,
UserCheck,
Users,
XCircle
} from 'lucide-react';
import {PropertyTimezoneSetup} from '@/components/leads/PropertyTimezoneSetup';
import React,{ useEffect,useState } from 'react';

interface WidgetStats {
  totalSessions: number;
  totalConversations: number;
  linkedSessions: number;
  uniqueLeads: number;
  tourBookingRate: number|null;
  asOf: string;
  complete: true;
  toursBooked: number;
  avgResponseTime: null;
  conversionRate: number|null;
}

interface RecentConversation {
  id: string;
  lead_name: string | null;
  lead_email: string | null;
  message_count: number;
  is_human_mode: boolean;
  created_at: string|null;
  last_message: string | null;
}

export default function LumaLeasingPage() {
  const { currentProperty,loading,hasLoadedProperties,properties,setProperty } = usePropertyContext()
  useEffect(() => {
    if(loading || !hasLoadedProperties) return
    const url = new URL(window.location.href);const target = url.searchParams.get('propertyId')
    if(target && (url.searchParams.has('success') || url.searchParams.has('error')) && properties.some(property => property.id === target)) {
      setProperty(target);url.searchParams.delete('propertyId');window.history.replaceState({},'',url.pathname+url.search)
    }
  }, [loading,hasLoadedProperties,properties,setProperty])
  if(loading) return <p role="status" className="p-6 text-sm text-slate-500">Loading property records…</p>
  if(!hasLoadedProperties) return <p role="alert" className="p-6 text-sm text-amber-700">Your property records are unavailable. Reload the page to try again.</p>
  return <LumaLeasingWorkspace key={currentProperty.id} />
}

function LumaLeasingWorkspace() {
  const { currentProperty } = usePropertyContext();
  const [activeTab, setActiveTab] = useState<'overview' | 'conversations' | 'integrations' | 'config'>('overview');
  const [connectionError,setConnectionError] = useState<string|null>(null);
  const [selectedConversation,setSelectedConversation]=useState<string|null>(null);
  useEffect(() => {const params=new URLSearchParams(window.location.search);if(params.has('success') || params.has('error')) setActiveTab('integrations');else if(params.get('tab')==='conversations')setActiveTab('conversations');const requested=params.get('conversation');if(requested&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(requested)){setSelectedConversation(requested);setActiveTab('conversations')};setConnectionError(params.get('error'))}, []);
  const [stats, setStats] = useState<WidgetStats | null>(null);
  const [conversations, setConversations] = useState<RecentConversation[]>([]);
  const [loading, setLoading] = useState(true);

  const [loadError,setLoadError] = useState(false)
  const [revision,setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setLoading(true);setLoadError(false);setStats(null);setConversations([])
    const load = async () => {
      try {
        const response=await fetch(`/api/lumaleasing/admin/stats?propertyId=${currentProperty.id}`,{signal:controller.signal,cache:'no-store'});
        if(!response.ok)throw new Error('Overview unavailable');
        const data=await response.json();if(data.complete!==true||data.propertyId!==currentProperty.id)throw new Error('Complete overview unavailable');
        if(active){setStats(data);setConversations(data.conversations)}
      } catch {if(active) setLoadError(true)}
      finally {if(active) setLoading(false)}
    }
    void load()
    return ()=>{active=false;controller.abort()}
  }, [currentProperty.id,revision])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-[#eaf0f2] flex items-center justify-center text-[#476d79]">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">LumaLeasing</h1>
            <p className="text-slate-500">Conversations, tours and leasing support for {currentProperty.name}</p>
          </div>
        </div>
      </div>

      {connectionError && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Connection needs attention</p>
        <p>{integrationFailureMessage(connectionError)}</p>
        <button type="button" className="mt-2 underline" onClick={()=>{setConnectionError(null);const url=new URL(window.location.href);url.searchParams.delete('error');window.history.replaceState({},'',url.pathname+url.search)}}>Dismiss connection message</button>
      </div>}
      <ReliabilityPanel key={currentProperty.id} propertyId={currentProperty.id} area="luma" />
      <RequestEvidence key={`requests-${currentProperty.id}`} propertyId={currentProperty.id}/>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {[
            { id: 'overview', label: 'Overview', icon: TrendingUp },
            { id: 'conversations', label: 'Conversations', icon: MessageSquare },
            { id: 'integrations', label: 'Integrations', icon: Link },
            { id: 'config', label: 'Configuration', icon: Settings },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as typeof activeTab)}
              className={`flex items-center gap-2 pb-4 border-b-2 transition-colors ${
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

      {loading && <p role="status" className="text-sm text-slate-500">Loading conversation records…</p>}
      {loadError && <div role="alert" className="rounded-xl border border-amber-200 p-4 text-sm text-amber-800">
        Conversation records could not be loaded. <button type="button" className="underline" onClick={()=>setRevision(value=>value+1)}>Try again</button>
      </div>}
      {/* Content */}
      {activeTab === 'overview' && !loading && !loadError && stats && (
        <div className="space-y-6">
          <p className="text-sm text-slate-500">All retained widget sessions and conversation records · Updated {new Date(stats.asOf).toLocaleString()}. Bookings include cancellations; counts do not prove tours were attended.</p>
          {/* Stats Grid */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard
              label="Total Sessions"
              value={stats.totalSessions}
              icon={Eye}
              color="indigo"
            />
            <StatCard
              label="Unique Leads"
              value={stats.uniqueLeads}
              icon={Users}
              color="emerald"
            />
            <StatCard
              label="Bookings Recorded"
              value={stats.toursBooked}
              icon={Calendar}
              color="violet"
            />
            <StatCard
              label="Sessions Linked to Leads"
              value={stats.conversionRate===null?'No sessions':`${stats.conversionRate}%`}
              icon={TrendingUp}
              color="amber"
            />
          </div>

          {/* Recent Activity */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Recent Conversations */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-900">Newest Widget Conversations</h3>
                <button
                  onClick={() => {setSelectedConversation(null);setActiveTab('conversations')}}
                  className="text-sm text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                >
                  View all <ArrowUpRight className="w-3 h-3" />
                </button>
              </div>
              
              {conversations.length === 0 ? (
                <div className="text-center py-8">
                  <MessageSquare className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500">No conversations yet</p>
                  <p className="text-sm text-slate-400">Conversations will appear here once visitors start chatting</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {conversations.slice(0, 5).map((conv) => (
                    <button key={conv.id} type="button" aria-label={`Open recent conversation: ${conv.lead_name||conv.lead_email||'Anonymous visitor'}`} onClick={()=>{setSelectedConversation(conv.id);setActiveTab('conversations')}} className="w-full text-left flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 transition-colors">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        conv.is_human_mode 
                          ? 'bg-amber-100 text-amber-600' 
                          : 'bg-indigo-100 text-indigo-600'
                      }`}>
                        {conv.is_human_mode ? <UserCheck className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 truncate">
                          {conv.lead_name || conv.lead_email || 'Anonymous Visitor'}
                        </p>
                        <p className="text-sm text-slate-500 truncate">
                          {conv.last_message || 'No messages'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-400">
                          {conv.created_at?new Date(conv.created_at).toLocaleDateString():'Time not recorded'}
                        </p>
                        <p className="text-xs text-slate-500">{conv.message_count} messages</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Stats */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h3 className="font-semibold text-slate-900 mb-4">Performance</h3>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Clock className="w-5 h-5 text-slate-400" />
                    <div>
                      <p className="text-sm font-medium text-slate-900">Response Timing</p>
                      <p className="text-xs text-slate-500">Separate assistant timing is not measured</p>
                    </div>
                  </div>
                  <p className="text-lg font-semibold text-slate-900">
                    Not measured
                  </p>
                </div>

                <div className="flex items-center justify-between p-4 bg-emerald-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-emerald-500" />
                    <div>
                      <p className="text-sm font-medium text-slate-900">Session Lead Link Rate</p>
                      <p className="text-xs text-slate-500">Sessions linked to a lead; repeat sessions count</p>
                    </div>
                  </div>
                  <p className="text-lg font-semibold text-emerald-600">
                    {stats.conversionRate===null?'No sessions':`${stats.conversionRate}%`}
                  </p>
                </div>

                <div className="flex items-center justify-between p-4 bg-violet-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Calendar className="w-5 h-5 text-violet-500" />
                    <div>
                      <p className="text-sm font-medium text-slate-900">Tour Booking Rate</p>
                      <p className="text-xs text-slate-500">Distinct linked leads with a non-cancelled Luma booking</p>
                    </div>
                  </div>
                  <p className="text-lg font-semibold text-violet-600">
                    {stats.tourBookingRate===null?'No linked leads':`${stats.tourBookingRate}%`}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'conversations' && <LumaConversationInbox propertyId={currentProperty.id} initialConversationId={selectedConversation}/> }

      {activeTab === 'integrations' && (
        <IntegrationsPanel propertyId={currentProperty.id} />
      )}

      {activeTab === 'config' && <LumaLeasingConfig />}
    </div>
  );
}

function StatCard({ 
  label, 
  value, 
  icon: Icon, 
  color 
}: { 
  label: string; 
  value: number | string; 
  icon: React.ElementType; 
  color: 'indigo' | 'emerald' | 'violet' | 'amber';
}) {
  const colors = {
    indigo: 'bg-indigo-50 text-indigo-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  );
}

function IntegrationsPanel({ propertyId }: { propertyId: string }) {
  const [calendarStatus, setCalendarStatus] = useState<{
    connected: boolean;
    state?: 'connected' | 'reconnect_required' | 'disconnected' | 'setup_required';
    timezone?: string | null;
    timezone_setup_required?: boolean;
    provider?: 'google' | 'microsoft';
    account_email?: string;
    email?: string;
    token_status?: string;
  } | null>(null);
  const [emailStatus, setEmailStatus] = useState<{
    connected: boolean;
    state?: 'connected' | 'reconnect_required' | 'disconnected';
    provider?: 'google' | 'microsoft';
    account_email?: string;
    email?: string;
    token_status?: string;
  } | null>(null);

  const [revision, setRevision] = useState(0);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusErrors, setStatusErrors] = useState({calendar: '', email: ''});
  useEffect(() => {
    const controller = new AbortController();
    setStatusLoading(true);setCalendarStatus(null);setEmailStatus(null);
    setStatusErrors({calendar: '', email: ''});
    const load = async (kind: 'calendar' | 'email') => {
      try {
        const response = await fetch(`/api/lumaleasing/${kind}/status?propertyId=${propertyId}`, {signal: controller.signal, cache: 'no-store'});
        if(!response.ok) throw new Error('Status unavailable');
        const status = await response.json();
        if(!controller.signal.aborted) (kind === 'calendar' ? setCalendarStatus : setEmailStatus)(status);
      } catch {
        if(!controller.signal.aborted) setStatusErrors(previous => ({...previous, [kind]: 'Connection status is unavailable. Retry before changing this account.'}));
      }
    };
    void Promise.all([load('calendar'), load('email')]).finally(() => {if(!controller.signal.aborted) setStatusLoading(false)});
    return () => controller.abort();
  }, [propertyId, revision]);

  const cards = [
    {
      key: 'google-calendar',
      title: 'Google Calendar',
      description: 'Connect Google Calendar for tour availability and booking events.',
      provider: 'google' as const,
      capability: 'calendar' as const,
      icon: Calendar,
      connectHref: `/api/lumaleasing/calendar/connect?propertyId=${propertyId}&provider=google`,
      color: 'bg-indigo-600 hover:bg-indigo-700',
    },
    {
      key: 'microsoft-calendar',
      title: 'Outlook Calendar / Teams',
      description: 'Connect Microsoft Outlook Calendar for tour scheduling and optional Teams links.',
      provider: 'microsoft' as const,
      capability: 'calendar' as const,
      icon: Calendar,
      connectHref: `/api/lumaleasing/calendar/connect?propertyId=${propertyId}&provider=microsoft`,
      color: 'bg-slate-900 hover:bg-slate-800',
    },
    {
      key: 'google-email',
      title: 'Gmail Inbox',
      description: 'Connect Gmail for outbound email and inbound lead reply sync.',
      provider: 'google' as const,
      capability: 'email' as const,
      icon: Mail,
      connectHref: `/api/lumaleasing/email/connect?propertyId=${propertyId}&provider=google`,
      color: 'bg-emerald-600 hover:bg-emerald-700',
    },
    {
      key: 'microsoft-email',
      title: 'Outlook Mail',
      description: 'Connect Microsoft Outlook Mail for outbound email and inbox reply sync.',
      provider: 'microsoft' as const,
      capability: 'email' as const,
      icon: Mail,
      connectHref: `/api/lumaleasing/email/connect?propertyId=${propertyId}&provider=microsoft`,
      color: 'bg-blue-600 hover:bg-blue-700',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h3 className="text-lg font-semibold text-slate-900">Calendar And Email Integrations</h3>
        <p className="text-sm text-slate-500 mt-1">
          Connect directly if you have access, or copy an external auth link for a client to authorize one property without a P11 login.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          const status = card.capability === 'calendar' ? calendarStatus : emailStatus;
          const matchesConnectedProvider =
            status?.provider === card.provider && status.state !== 'disconnected';
          const isHealthy = matchesConnectedProvider && status?.state === 'connected';
          const statusError = statusErrors[card.capability];
          const needsSetup = card.capability === 'calendar' && matchesConnectedProvider && calendarStatus?.timezone_setup_required;
          const needsReconnect = matchesConnectedProvider && status?.state === 'reconnect_required';
          const accountEmail = status?.account_email || status?.email;

          return (
            <div key={card.key} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-slate-900">{card.title}</h4>
                  <p className="text-sm text-slate-500 mt-1">{card.description}</p>
                  {statusLoading && <p role="status" className="mt-3 text-sm text-slate-500">Loading connection status…</p>}
                  {statusError && <div role="alert" className="mt-3 text-sm text-red-700"><p>{statusError}</p><button type="button" onClick={() => setRevision(value => value + 1)} className="mt-2 underline">Retry {card.title} status</button></div>}
                  {matchesConnectedProvider && (
                    <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                      isHealthy
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-amber-50 border-amber-200 text-amber-800'
                    }`}>
                      <div className="flex items-center gap-2 font-medium">
                        {isHealthy ? (
                          <CheckCircle className="w-4 h-4" />
                        ) : (
                          <XCircle className="w-4 h-4" />
                        )}
                        {isHealthy ? 'Connected' : status?.state === 'setup_required' ? 'Timezone setup required' : 'Reconnect required'}
                      </div>
                      {accountEmail && (
                        <p className="mt-1 text-xs">{accountEmail}</p>
                      )}
                      {status?.token_status && (
                        <p className="mt-1 text-xs">{status.token_status === 'refresh_unconfirmed' ? 'Renewal could not be confirmed. Reconnect this account.' : status.token_status === 'healthy' && !isHealthy ? 'Access needs attention' : `Access: ${status.token_status.replaceAll('_', ' ')}`}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {needsSetup && <div className="mt-4"><PropertyTimezoneSetup key={propertyId} propertyId={propertyId} onSaved={() => setRevision(value => value + 1)}/></div>}
              {card.capability === 'calendar' && matchesConnectedProvider && calendarStatus?.timezone && <p className="mt-3 text-sm text-slate-600">Tour timezone: {calendarStatus.timezone}</p>}
              <div className="flex flex-wrap gap-2 mt-5">
                <button
                  onClick={() => window.location.href = card.connectHref}
                  disabled={statusLoading || !!statusError}
                  className={`px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors ${card.color}`}
                >
                  {needsReconnect ? 'Reconnect' : matchesConnectedProvider ? 'Reconnect' : 'Connect'}
                </button>

              </div>
            </div>
          );
        })}
      </div>
      <IntegrationReplacementPanel key={`replacement-${propertyId}`} propertyId={propertyId}/>
      <IntegrationInvitesPanel key={propertyId} propertyId={propertyId}/>
    </div>
  );
}

