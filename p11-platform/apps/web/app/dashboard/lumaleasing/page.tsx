'use client';

import React, { useState, useEffect } from 'react';
import { 
  MessageSquare, Users, Calendar, TrendingUp, Clock, 
  CheckCircle, XCircle, ArrowUpRight, Eye, Settings,
  Sparkles, Bot, UserCheck, Mail, Copy, Link
} from 'lucide-react';
import { usePropertyContext } from '@/components/layout/PropertyContext';
import { LumaLeasingConfig } from '@/components/lumaleasing/LumaLeasingConfig';

interface WidgetStats {
  totalSessions: number;
  totalConversations: number;
  leadsCapture: number;
  toursBooked: number;
  avgResponseTime: number;
  conversionRate: number;
}

interface RecentConversation {
  id: string;
  lead_name: string | null;
  lead_email: string | null;
  message_count: number;
  is_human_mode: boolean;
  created_at: string;
  last_message: string | null;
}

export default function LumaLeasingPage() {
  const { currentProperty } = usePropertyContext();
  const [activeTab, setActiveTab] = useState<'overview' | 'conversations' | 'integrations' | 'config'>('overview');
  const [stats, setStats] = useState<WidgetStats | null>(null);
  const [conversations, setConversations] = useState<RecentConversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [currentProperty.id]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load stats
      const statsRes = await fetch(`/api/lumaleasing/admin/stats?propertyId=${currentProperty.id}`);
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }

      // Load recent conversations
      const convsRes = await fetch(`/api/lumaleasing/admin/conversations?propertyId=${currentProperty.id}`);
      if (convsRes.ok) {
        const convsData = await convsRes.json();
        setConversations(convsData.conversations || []);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">LumaLeasing</h1>
            <p className="text-slate-500">AI-powered leasing assistant for {currentProperty.name}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <div className="flex gap-8">
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

      {/* Content */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-4 gap-4">
            <StatCard
              label="Total Sessions"
              value={stats?.totalSessions || 0}
              icon={Eye}
              trend="+12%"
              color="indigo"
            />
            <StatCard
              label="Leads Captured"
              value={stats?.leadsCapture || 0}
              icon={Users}
              trend="+8%"
              color="emerald"
            />
            <StatCard
              label="Tours Booked"
              value={stats?.toursBooked || 0}
              icon={Calendar}
              trend="+15%"
              color="violet"
            />
            <StatCard
              label="Conversion Rate"
              value={`${stats?.conversionRate || 0}%`}
              icon={TrendingUp}
              trend="+3%"
              color="amber"
            />
          </div>

          {/* Recent Activity */}
          <div className="grid grid-cols-2 gap-6">
            {/* Recent Conversations */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-900">Recent Conversations</h3>
                <button
                  onClick={() => setActiveTab('conversations')}
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
                    <div key={conv.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 transition-colors">
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
                          {new Date(conv.created_at).toLocaleDateString()}
                        </p>
                        <p className="text-xs text-slate-500">{conv.message_count} messages</p>
                      </div>
                    </div>
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
                      <p className="text-sm font-medium text-slate-900">Avg Response Time</p>
                      <p className="text-xs text-slate-500">First AI response</p>
                    </div>
                  </div>
                  <p className="text-lg font-semibold text-slate-900">
                    {stats?.avgResponseTime || 0}ms
                  </p>
                </div>

                <div className="flex items-center justify-between p-4 bg-emerald-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-emerald-500" />
                    <div>
                      <p className="text-sm font-medium text-slate-900">Lead Capture Rate</p>
                      <p className="text-xs text-slate-500">Visitors who became leads</p>
                    </div>
                  </div>
                  <p className="text-lg font-semibold text-emerald-600">
                    {stats?.conversionRate || 0}%
                  </p>
                </div>

                <div className="flex items-center justify-between p-4 bg-violet-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Calendar className="w-5 h-5 text-violet-500" />
                    <div>
                      <p className="text-sm font-medium text-slate-900">Tour Booking Rate</p>
                      <p className="text-xs text-slate-500">Leads who booked tours</p>
                    </div>
                  </div>
                  <p className="text-lg font-semibold text-violet-600">
                    {stats?.leadsCapture ? Math.round((stats.toursBooked / stats.leadsCapture) * 100) : 0}%
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'conversations' && (
        <ConversationsList 
          conversations={conversations} 
          propertyId={currentProperty.id}
          onRefresh={loadData}
        />
      )}

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
  trend, 
  color 
}: { 
  label: string; 
  value: number | string; 
  icon: React.ElementType; 
  trend: string;
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
        <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
          {trend}
        </span>
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  );
}

function ConversationsList({ 
  conversations, 
  propertyId,
  onRefresh 
}: { 
  conversations: RecentConversation[];
  propertyId: string;
  onRefresh: () => void;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200">
      <div className="p-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900">All Conversations</h3>
        <button 
          onClick={onRefresh}
          className="text-sm text-indigo-600 hover:text-indigo-700"
        >
          Refresh
        </button>
      </div>
      
      {conversations.length === 0 ? (
        <div className="text-center py-12">
          <MessageSquare className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-500 font-medium">No conversations yet</p>
          <p className="text-sm text-slate-400 mt-1">
            Widget conversations will appear here
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {conversations.map((conv) => (
            <div key={conv.id} className="p-4 hover:bg-slate-50 transition-colors cursor-pointer">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                  conv.is_human_mode 
                    ? 'bg-amber-100 text-amber-600' 
                    : 'bg-indigo-100 text-indigo-600'
                }`}>
                  {conv.is_human_mode ? <UserCheck className="w-6 h-6" /> : <Bot className="w-6 h-6" />}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-slate-900">
                      {conv.lead_name || 'Anonymous Visitor'}
                    </p>
                    {conv.is_human_mode && (
                      <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">
                        Human Mode
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500">{conv.lead_email || 'No email'}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-slate-900">{conv.message_count} messages</p>
                  <p className="text-xs text-slate-400">
                    {new Date(conv.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
              {conv.last_message && (
                <p className="mt-2 text-sm text-slate-600 truncate pl-16">
                  "{conv.last_message}"
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IntegrationsPanel({ propertyId }: { propertyId: string }) {
  const [creatingLink, setCreatingLink] = useState<string | null>(null);
  const [calendarStatus, setCalendarStatus] = useState<{
    connected: boolean;
    state?: 'connected' | 'reconnect_required' | 'disconnected';
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

  useEffect(() => {
    const loadIntegrationStatus = async () => {
      try {
        const [calendarResponse, emailResponse] = await Promise.all([
          fetch(`/api/lumaleasing/calendar/status?propertyId=${propertyId}`),
          fetch(`/api/lumaleasing/email/status?propertyId=${propertyId}`),
        ]);

        if (calendarResponse.ok) {
          setCalendarStatus(await calendarResponse.json());
        }
        if (emailResponse.ok) {
          setEmailStatus(await emailResponse.json());
        }
      } catch (error) {
        console.error('Failed to load integration status:', error);
      }
    };

    loadIntegrationStatus();
  }, [propertyId]);

  const createExternalAuthLink = async (
    provider: 'google' | 'microsoft',
    capability: 'calendar' | 'email'
  ) => {
    try {
      setCreatingLink(`${provider}-${capability}`);
      const response = await fetch('/api/lumaleasing/integration-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          provider,
          capabilities: [capability],
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error || 'Failed to create authorization link');
      }
      await navigator.clipboard.writeText(payload.url);
      alert('Authorization link copied.');
    } catch (error) {
      console.error('Failed to create authorization link:', error);
      alert(error instanceof Error ? error.message : 'Failed to create authorization link');
    } finally {
      setCreatingLink(null);
    }
  };

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
          const isCreating = creatingLink === `${card.provider}-${card.capability}`;
          const status = card.capability === 'calendar' ? calendarStatus : emailStatus;
          const matchesConnectedProvider =
            status?.provider === card.provider && status.state !== 'disconnected';
          const isHealthy = matchesConnectedProvider && status?.state === 'connected';
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
                        {isHealthy ? 'Connected' : 'Reconnect required'}
                      </div>
                      {accountEmail && (
                        <p className="mt-1 text-xs">{accountEmail}</p>
                      )}
                      {status?.token_status && (
                        <p className="mt-1 text-xs">Token: {status.token_status}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-5">
                <button
                  onClick={() => window.location.href = card.connectHref}
                  className={`px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors ${card.color}`}
                >
                  {needsReconnect ? 'Reconnect' : matchesConnectedProvider ? 'Reconnect / Change Account' : 'Connect'}
                </button>
                <button
                  onClick={() => createExternalAuthLink(card.provider, card.capability)}
                  disabled={isCreating}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
                >
                  <Copy className="w-4 h-4" />
                  {isCreating ? 'Creating...' : 'Copy Client Link'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

