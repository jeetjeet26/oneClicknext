'use client';
import { syncLeadBatch } from '@/utils/crm/prepare-lead-batch';
import {LumaConversationInbox} from '@/components/lumaleasing/LumaConversationInbox';
import { LeadRecordEditor, LeadRecordRecovery, LeadRecordHistory, LeadFollowupControls } from '@/components/leads/LeadRecordControls';
import { useLeadRecords, type RecordLead, type LeadRecordController } from '@/utils/leads/use-lead-records';
import { WorkflowDeliveryHistory } from '@/components/leads/WorkflowDeliveryHistory';
import { TourScheduleDeliveryHistory } from '@/components/leads/TourScheduleDeliveryHistory';
import { TourReminderHistory } from '@/components/leads/TourReminderHistory';
import { TourScheduleForm } from '@/components/leads/TourScheduleForm';
import type { ScheduleResult, ScheduleHistory } from '@/utils/services/tour-scheduling';
import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import type { TourCorrection } from '@/utils/services/tour-outcomes';
import { TourOutcomeForm, type SavedTourOutcome } from '@/components/leads/TourOutcomeForm';
import { usePropertyContext } from '@/components/layout/PropertyContext';
import { Search, ChevronDown, ChevronLeft, ChevronRight, Mail, Phone, Calendar, RefreshCw, Sparkles, User, X, MoreVertical, MessageSquare, CheckCircle2, Clock, Home, XCircle, Plus, Zap, Pause, Play, Square, Send, BedDouble, FileText, MapPin, Settings, Database, Link2, Upload, Loader2, SkipForward, AlertTriangle } from 'lucide-react';
import { formatDistanceToNow, format, parseISO, isAfter } from 'date-fns';
import { TourScheduleModal } from '@/components/leads/TourScheduleModal';
import { ActivityTimeline } from '@/components/leads/ActivityTimeline';
type Lead = RecordLead;
type TourLead = {
    id: string;
    first_name: string;
    last_name: string;
    email?: string;
    phone?: string;
    property_id: string;
};
type LeadsResponse = {
    leads: Lead[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
    filters: {
        sources: string[];
        statuses: string[];
    };
    statusSummary: Record<string, number>;
};
type Workflow = {
    id: string;
    current_step: number;
    status: 'active' | 'paused' | 'completed' | 'converted' | 'stopped';
    last_action_at: string;
    next_action_at: string | null;
    workflow?: {
        name: string;
        steps: Array<{
            id: number;
            delay_hours: number;
            action: string;
            template_slug: string;
        }>;
    };
    action_visibility?: {
        counts: {
            pending: number;
            skipped: number;
            retried: number;
            paused: number;
            failed: number;
        };
        recent_issues: Array<{
            id: string;
            step_number: number;
            action_type: string;
            status: 'failed' | 'skipped';
            created_at: string | null;
            error_message: string | null;
        }>;
    };
};
type Tour = {
    timezone?: string | null;
    starts_at?: string | null;
    no_show_review?: import('@/utils/services/tour-noshow').NoShowReview | null;
    schedule_version: number;
    schedule_change?: ScheduleHistory | null;
    id: string;
    tour_date: string;
    tour_time: string;
    tour_type: 'in_person' | 'virtual' | 'self_guided';
    status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
    correction?: TourCorrection | null;
    outcome_notes?: string | null;
    notes?: string;
    created_at: string;
};
const TOUR_TYPE_CONFIG = {
    in_person: { label: 'In-Person', icon: MapPin, color: 'text-indigo-600 bg-indigo-100' },
    virtual: { label: 'Virtual', icon: Calendar, color: 'text-purple-600 bg-purple-100' },
    self_guided: { label: 'Self-Guided', icon: Home, color: 'text-emerald-600 bg-emerald-100' },
};
const TOUR_STATUS_CONFIG = {
    scheduled: { label: 'Scheduled', color: 'bg-blue-100 text-blue-700' },
    confirmed: { label: 'Confirmed', color: 'bg-emerald-100 text-emerald-700' },
    completed: { label: 'Completed', color: 'bg-slate-100 text-slate-700' },
    cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-700' },
    no_show: { label: 'No Show', color: 'bg-amber-100 text-amber-700' },
};
const STATUS_CONFIG = {
    new: {
        label: 'New',
        color: 'bg-blue-100 text-blue-700 border-blue-200',
        icon: Sparkles,
        bgLight: 'bg-blue-50'
    },
    contacted: {
        label: 'Contacted',
        color: 'bg-amber-100 text-amber-700 border-amber-200',
        icon: MessageSquare,
        bgLight: 'bg-amber-50'
    },
    tour_booked: {
        label: 'Tour Booked',
        color: 'bg-purple-100 text-purple-700 border-purple-200',
        icon: Calendar,
        bgLight: 'bg-purple-50'
    },
    toured: {
        label: 'Toured',
        color: 'bg-indigo-100 text-indigo-700 border-indigo-200',
        icon: CheckCircle2,
        bgLight: 'bg-indigo-50'
    },
    leased: {
        label: 'Leased',
        color: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        icon: CheckCircle2,
        bgLight: 'bg-emerald-50'
    },
    lost: {
        label: 'Lost',
        color: 'bg-slate-100 text-slate-600 border-slate-200',
        icon: XCircle,
        bgLight: 'bg-slate-50'
    },
};
const UNKNOWN_STATUS = { label: 'Unrecognized status', color: 'bg-slate-100 text-slate-600 border-slate-200', icon: AlertTriangle, bgLight: 'bg-slate-50' };
const WORKFLOW_STATUS_CONFIG = {
    active: { label: 'Active', color: 'bg-green-100 text-green-700', icon: Zap },
    paused: { label: 'Paused', color: 'bg-amber-100 text-amber-700', icon: Pause },
    completed: { label: 'Completed', color: 'bg-blue-100 text-blue-700', icon: CheckCircle2 },
    converted: { label: 'Converted', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
    stopped: { label: 'Stopped', color: 'bg-slate-100 text-slate-600', icon: Square },
};
function StatusBadge({ status }: {
    status: Lead['status'];
}) {
    const config = STATUS_CONFIG[status] || UNKNOWN_STATUS;
    const Icon = config.icon;
    return (<span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${config.color}`}>
      <Icon size={12}/>
      {config.label}
    </span>);
}
function ScoreBadge({ score }: {
    score?: number | null;
    bucket?: string | null;
}) {
    if (!score)
        return null;
    const getColor = () => {
        if (score >= 70)
            return 'bg-emerald-100 text-emerald-700 border-emerald-200';
        if (score >= 40)
            return 'bg-amber-100 text-amber-700 border-amber-200';
        return 'bg-slate-100 text-slate-600 border-slate-200';
    };
    return (<span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${getColor()}`}>
      <Zap size={10}/>
      {score}
    </span>);
}
function LeadRow({ lead, onStatusChange, onSelect, isSelected, onToggleSelect, canManage }: {
    lead: Lead;
    onStatusChange: (leadId: string, status: Lead['status']) => void;
    onSelect: (lead: Lead) => void;
    isSelected: boolean;
    onToggleSelect: (leadId: string) => void;
    canManage: boolean;
}) {
    const [showStatusMenu, setShowStatusMenu] = useState(false);
    const config = STATUS_CONFIG[lead.status] || UNKNOWN_STATUS;
    const lastTouchAt = lead.updated_at || lead.created_at;
    const getCRMSyncBadge = () => {
        if (!lead.crm_sync_status)
            return null;
        const syncConfig = {
            pending: { icon: Loader2, color: 'text-amber-600', bg: 'bg-amber-50', label: lead.external_crm_id ? 'In CRM · update pending' : 'Pending sync' },
            retrying: { icon: Loader2, color: 'text-orange-600', bg: 'bg-orange-50', label: 'Retrying' },
            created: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Synced' },
            linked: { icon: Link2, color: 'text-blue-600', bg: 'bg-blue-50', label: 'Linked' },
            failed: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', label: 'Failed' },
            skipped: { icon: SkipForward, color: 'text-slate-400', bg: 'bg-slate-50', label: 'Skipped' },
            dead_lettered: { icon: AlertTriangle, color: 'text-red-700', bg: 'bg-red-100', label: 'Dead Letter' },
        };
        const syncStatus = syncConfig[lead.crm_sync_status];
        if (!syncStatus)
            return null;
        const SyncIcon = syncStatus.icon;
        return (<div className={`inline-flex items-center gap-1 px-2 py-0.5 ${syncStatus.bg} rounded text-xs`}>
        <SyncIcon size={12} className={syncStatus.color}/>
        <span className={syncStatus.color}>{syncStatus.label}</span>
      </div>);
    };
    return (<tr className={`border-b border-slate-100 hover:bg-slate-50/50 transition-colors ${config.bgLight}`}>
      <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={isSelected} onChange={() => onToggleSelect(lead.id)} className="w-4 h-4 text-teal-600 border-slate-300 rounded focus:ring-teal-500 cursor-pointer"/>
      </td>
      <td className="px-4 py-4 cursor-pointer" onClick={() => onSelect(lead)}>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white font-medium text-sm shadow-sm">
            {lead.first_name[0]}{lead.last_name[0]}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium text-slate-900">{lead.first_name} {lead.last_name}</p>
              <ScoreBadge score={lead.score} bucket={lead.score_bucket}/>
              {getCRMSyncBadge()}
            </div>
            <p className="text-sm text-slate-500">{lead.email}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="relative" onClick={e => e.stopPropagation()}>
          <button disabled={!canManage} onClick={() => setShowStatusMenu(!showStatusMenu)} className="hover:opacity-80 transition-opacity">
            <StatusBadge status={lead.status}/>
          </button>
          
          {showStatusMenu && (<>
              <div className="fixed inset-0 z-10" onClick={() => setShowStatusMenu(false)}/>
              <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-20 min-w-[160px]">
                {Object.entries(STATUS_CONFIG).map(([key, config]) => {
                const Icon = config.icon;
                return (<button key={key} onClick={() => {
                        onStatusChange(lead.id, key as Lead['status']);
                        setShowStatusMenu(false);
                    }} className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-2 ${lead.status === key ? 'bg-slate-50 font-medium' : ''}`}>
                      <Icon size={14}/>
                      {config.label}
                    </button>);
            })}
              </div>
            </>)}
        </div>
      </td>
      <td className="px-4 py-4">
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">
          {lead.source}
        </span>
      </td>
      <td className="px-4 py-4">
        {lead.phone ? (<a href={`tel:${lead.phone}`} className="text-sm text-slate-600 hover:text-indigo-600 flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
            <Phone size={14}/>
            {lead.phone}
          </a>) : (<span className="text-sm text-slate-400">—</span>)}
      </td>
      <td className="px-4 py-4">
        <div className="flex items-center gap-1.5 text-sm text-slate-500">
          <Clock size={14}/>
          {formatDistanceToNow(new Date(lastTouchAt), { addSuffix: true })}
        </div>
      </td>
      <td className="px-4 py-4">
        <button onClick={e => {
            e.stopPropagation();
            onSelect(lead);
        }} className="p-1.5 hover:bg-slate-200 rounded-md transition-colors">
          <MoreVertical size={16} className="text-slate-400"/>
        </button>
      </td>
    </tr>);
}
function WorkflowStatus({ workflow, onAction, busy }: {
    busy: boolean;
    workflow: Workflow | null;
    onAction: (action: 'pause' | 'resume' | 'stop') => void;
}) {
    if (!workflow) {
        return (<div className="bg-slate-50 rounded-xl p-4 text-center">
        <Zap className="mx-auto text-slate-300 mb-2" size={24}/>
        <p className="text-sm text-slate-500">No active automation</p>
      </div>);
    }
    const config = WORKFLOW_STATUS_CONFIG[workflow.status];
    const Icon = config.icon;
    const steps = workflow.workflow?.steps || [];
    const totalSteps = steps.length;
    const currentStep = workflow.current_step;
    return (<div className="bg-gradient-to-br from-slate-50 to-indigo-50/30 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap className="text-amber-500" size={18}/>
          <span className="font-medium text-slate-900 text-sm">
            {workflow.workflow?.name || 'Automation'}
          </span>
        </div>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.color}`}>
          <Icon size={10}/>
          {config.label}
        </span>
      </div>

      {/* Progress */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
          <span>Step {Math.min(currentStep + 1, totalSteps)} of {totalSteps}</span>
          {workflow.next_action_at && workflow.status === 'active' && (<span>Next: {formatDistanceToNow(new Date(workflow.next_action_at), { addSuffix: true })}</span>)}
        </div>
        <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500" style={{ width: `${totalSteps ? (currentStep / totalSteps) * 100 : 0}%` }}/>
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-1.5 mb-3">
        {steps.slice(0, 3).map((step, i) => (<div key={`${i}:${step.id ?? step.action}`} className={`flex items-center gap-2 text-xs ${i < currentStep
                ? 'text-emerald-600'
                : i === currentStep
                    ? 'text-indigo-600 font-medium'
                    : 'text-slate-400'}`}>
            {i < currentStep ? (<CheckCircle2 size={12}/>) : i === currentStep ? (<div className="w-3 h-3 border-2 border-indigo-500 rounded-full animate-pulse"/>) : (<div className="w-3 h-3 border border-slate-300 rounded-full"/>)}
            <span className="capitalize">{step.action}</span>
            <span className="text-slate-400">
              (+{step.delay_hours}h)
            </span>
          </div>))}
        {steps.length > 3 && (<p className="text-xs text-slate-400 pl-5">+{steps.length - 3} more steps</p>)}
      </div>

      {workflow.action_visibility && (<div className="mb-3 rounded-lg border border-slate-200 bg-white/70 p-3">
          <div className="grid grid-cols-5 gap-2 text-center text-[11px]">
            {([
                ['Pending', workflow.action_visibility.counts.pending, 'text-slate-700 bg-slate-100'],
                ['Skipped', workflow.action_visibility.counts.skipped, 'text-slate-600 bg-slate-100'],
                ['Retried', workflow.action_visibility.counts.retried, 'text-indigo-700 bg-indigo-100'],
                ['Paused', workflow.action_visibility.counts.paused, 'text-amber-700 bg-amber-100'],
                ['Failed', workflow.action_visibility.counts.failed, 'text-red-700 bg-red-100'],
            ] as const).map(([label, count, style]) => (<div key={label}>
                <p className="text-slate-500">{label}</p>
                <p className={`mt-1 rounded px-1.5 py-0.5 font-semibold ${style}`}>{count}</p>
              </div>))}
          </div>

          {workflow.action_visibility.recent_issues.length > 0 && (<div className="mt-3 space-y-1.5">
              {workflow.action_visibility.recent_issues.map((issue) => (<div key={issue.id} className="flex items-start gap-2 rounded bg-amber-50 px-2 py-1.5">
                  <AlertTriangle size={12} className="mt-0.5 text-amber-700"/>
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-amber-900">
                      Step {issue.step_number + 1} {issue.action_type} {issue.status}
                    </p>
                    {issue.error_message && (<p className="truncate text-[11px] text-amber-800">{issue.error_message}</p>)}
                  </div>
                </div>))}
            </div>)}
        </div>)}

      {/* Actions */}
      {(workflow.status === 'active' || workflow.status === 'paused') && (<div className="flex gap-2">
          {workflow.status === 'active' ? (<button disabled={busy} onClick={() => onAction('pause')} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-100 rounded-lg hover:bg-amber-200 transition-colors">
              <Pause size={12}/>
              Pause
            </button>) : (<button disabled={busy} onClick={() => onAction('resume')} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-100 rounded-lg hover:bg-emerald-200 transition-colors">
              <Play size={12}/>
              Resume
            </button>)}
          <button disabled={busy} onClick={() => onAction('stop')} className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">
            <Square size={12}/>
            Stop
          </button>
        </div>)}
    </div>);
}

function SendMessageModal({ isOpen, onClose, lead, onSent }: {
    isOpen: boolean;
    onClose: () => void;
    lead: Lead;
    propertyId: string;
    onSent: () => void;
}) {
    const [channel, setChannel] = useState<'sms' | 'email'>('sms');
    const [message, setMessage] = useState('');
    const [subject, setSubject] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const handleSend = async () => {
        if (!message.trim())
            return;
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/leads/${lead.id}/send-message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    channel,
                    message: message.trim(),
                    subject: channel === 'email' ? subject.trim() : undefined,
                }),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Failed to send message');
            }
            setMessage('');
            setSubject('');
            onSent();
            onClose();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to send');
        }
        finally {
            setLoading(false);
        }
    };
    if (!isOpen)
        return null;
    const canSendSMS = !!lead.phone;
    const canSendEmail = !!lead.email;
    return (<>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]" onClick={onClose}/>
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="modal-light-mode bg-white rounded-2xl shadow-2xl w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
          <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Send className="text-indigo-600" size={20}/>
              Send Message
            </h3>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
              <X size={20} className="text-slate-500"/>
            </button>
          </div>

          <div className="p-6 space-y-4">
            {/* Channel Selection */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Send via
              </label>
              <div className="flex gap-2">
                <button onClick={() => setChannel('sms')} disabled={!canSendSMS} className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${channel === 'sms'
            ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
            : 'border-slate-200 text-slate-600 hover:bg-slate-50'} disabled:opacity-50 disabled:cursor-not-allowed`}>
                  <Phone size={16}/>
                  SMS
                </button>
                <button onClick={() => setChannel('email')} disabled={!canSendEmail} className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${channel === 'email'
            ? 'border-blue-500 bg-blue-50 text-blue-700'
            : 'border-slate-200 text-slate-600 hover:bg-slate-50'} disabled:opacity-50 disabled:cursor-not-allowed`}>
                  <Mail size={16}/>
                  Email
                </button>
              </div>
              {!canSendSMS && !canSendEmail && (<p className="text-xs text-red-500 mt-1">Lead has no contact information</p>)}
            </div>

            {/* Recipient */}
            <div className="bg-slate-50 rounded-lg px-4 py-3">
              <p className="text-xs text-slate-500 mb-1">To</p>
              <p className="text-sm font-medium text-slate-900">
                {lead.first_name} {lead.last_name}
              </p>
              <p className="text-sm text-slate-600">
                {channel === 'sms' ? lead.phone : lead.email}
              </p>
            </div>

            {/* Subject (email only) */}
            {channel === 'email' && (<div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Subject
                </label>
                <input type="text" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Re: Your inquiry about..." className="w-full px-3 py-2.5 border border-slate-300 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"/>
              </div>)}

            {/* Message */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Message
              </label>
              <textarea value={message} onChange={e => setMessage(e.target.value)} rows={channel === 'sms' ? 3 : 5} placeholder={channel === 'sms'
            ? "Hi! Just following up on your inquiry..."
            : "Hi,\n\nThank you for your interest in..."} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none"/>
              {channel === 'sms' && (<p className="text-xs text-slate-400 mt-1">
                  {message.length}/160 characters
                </p>)}
            </div>

            {error && (<div className="bg-red-50 text-red-700 text-sm px-4 py-2 rounded-lg">
                {error}
              </div>)}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors font-medium">
                Cancel
              </button>
              <button onClick={handleSend} disabled={loading || !message.trim() || (channel === 'sms' && !canSendSMS) || (channel === 'email' && !canSendEmail)} className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {loading ? (<>
                    <RefreshCw size={16} className="animate-spin"/>
                    Sending...
                  </>) : (<>
                    <Send size={16}/>
                    Send {channel === 'sms' ? 'SMS' : 'Email'}
                  </>)}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>);
}
function TourNoShowReview({ review }: {
    review: NonNullable<Tour['no_show_review']>;
}) {
    if (review.state === 'upcoming' || review.state === 'due')
        return null;
    const message = review.state === 'backlog' ? 'This tour is over seven days old. Automatic no-show processing is held. Check attendance and record the actual outcome below.'
        : review.state === 'needs_timezone' ? 'Set the property timezone before automatic no-show processing. You can still record a verified outcome below.'
            : review.state === 'ambiguous_time' ? 'The scheduled time is ambiguous because of a clock change. Verify attendance and record the actual outcome below.'
                : review.state === 'needs_lead' ? 'A linked prospect is required before this tour can be processed.'
                    : review.state === 'backoff' ? `Automatic processing was deferred after attempt ${review.attempts} of 3.${review.nextTryAt ? ` Next attempt no earlier than ${format(parseISO(review.nextTryAt), 'MMM d, h:mm a')}.` : ''}`
                        : review.errorCode === 'delivery_review_required' ? 'Review the earlier calendar or message delivery before recording this outcome.'
                            : 'Automatic processing stopped after repeated failures. Check the follow-up setup, then record the verified outcome below.';
    return <div role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
    <p className="font-medium">{review.state === 'backoff' ? 'Automatic outcome waiting' : 'Tour needs review'}</p><p>{message}</p>
    <p className="mt-1 text-xs">No-show follow-ups are held when the tour started more than 24 hours ago.</p>
  </div>;
}
function TourCard({ tour, onOutcomeSaved, onScheduleSaved, leadId }: {
    tour: Tour;
    leadId?: string;
    onOutcomeSaved?: (result: SavedTourOutcome) => void;
    onScheduleSaved?: (result: ScheduleResult) => void;
}) {
    const typeConfig = TOUR_TYPE_CONFIG[tour.tour_type];
    const statusConfig = TOUR_STATUS_CONFIG[tour.status];
    const TypeIcon = typeConfig.icon;
    const isPast = Boolean(tour.starts_at) && !isAfter(new Date(tour.starts_at!), new Date());
    const isActive = tour.status === 'scheduled' || tour.status === 'confirmed';
    return (<div className={`bg-white border rounded-xl p-4 ${isPast && !isActive && tour.status !== 'no_show' ? 'opacity-75' : ''}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`p-2 rounded-lg ${typeConfig.color}`}>
            <TypeIcon size={16}/>
          </div>
          <div>
            <p className="font-medium text-slate-900">
              {typeConfig.label} Tour
            </p>
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusConfig.color}`}>
              {statusConfig.label}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2 text-slate-600">
          <Calendar size={14} className="text-slate-400"/>
          {format(parseISO(tour.tour_date), 'EEEE, MMMM d, yyyy')}
        </div>
        <div className="flex items-center gap-2 text-slate-600">
          <Clock size={14} className="text-slate-400"/>
          {format(new Date(`2000-01-01T${tour.tour_time}`), 'h:mm a')} · {tour.timezone || 'Timezone needs review'}
        </div>
        {tour.notes && (<p className="text-slate-500 text-xs mt-2 pt-2 border-t border-slate-100">
            {tour.notes}
          </p>)}
      </div>

      {tour.outcome_notes && !tour.correction && <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-700"><span className="font-medium">Outcome notes: </span>{tour.outcome_notes}</p>}

      {tour.correction && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-medium">Corrected from no-show</p>
        <p>{tour.correction.reason}</p>
        <p className="mt-1 text-xs">{format(parseISO(tour.correction.recordedAt), 'MMM d, yyyy h:mm a')}</p>
        {tour.correction.previousDelivery === 'sent' && <p className="mt-1 text-xs">A no-show message was previously sent. It cannot be recalled.</p>}
        {tour.correction.previousDelivery === 'unknown' && <p className="mt-1 text-xs">Earlier no-show delivery is unconfirmed. Check the message history.</p>}
      </div>}
      {tour.status === 'no_show' && leadId && onOutcomeSaved && <TourOutcomeForm correction leadId={leadId} tourId={tour.id} onSaved={onOutcomeSaved}/>}

      {isActive && tour.no_show_review && <TourNoShowReview review={tour.no_show_review}/>}

      {isActive && leadId && onOutcomeSaved && <TourOutcomeForm leadId={leadId} tourId={tour.id} onSaved={onOutcomeSaved}/>}

      {tour.schedule_change && <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
        <p className="font-medium">{tour.schedule_change.action === 'cancel' ? 'Cancellation recorded' : 'Schedule updated'}</p>
        <p>{tour.schedule_change.reason}</p>
        <p className="mt-1 text-xs">{tour.schedule_change.delivery === 'review' ? 'Delivery needs review. Check the connected calendar and message history.' : tour.schedule_change.delivery === 'pending' ? 'Calendar or prospect updates are pending.' : tour.schedule_change.delivery === 'not_sent' ? 'Some updates were not sent. Review the tour change delivery history.' : tour.schedule_change.delivery === 'complete' ? 'Queued updates were confirmed.' : 'No external updates were queued.'}</p>
      </div>}
      {isActive && leadId && onScheduleSaved && <TourScheduleForm key={`${tour.id}/${tour.schedule_version}`} leadId={leadId} tour={tour} onSaved={onScheduleSaved}/>}

    </div>);
}
function LeadDetailDrawer({ lead, onClose, onStatusChange, onOutcomeStatusSaved, controller, propertyId }: {
    lead: Lead | null;
    onClose: () => void;
    onStatusChange: (leadId: string, status: Lead['status']) => void;
    onOutcomeStatusSaved: (leadId: string, status: Lead['status']) => void;
    propertyId: string;
    controller: LeadRecordController;
}) {
    const [workflow, setWorkflow] = useState<Workflow | null>(null);
    const [workflowBusy, setWorkflowBusy] = useState(false), [workflowError, setWorkflowError] = useState(''), [workflowLoading, setWorkflowLoading] = useState(true);
    const workflowActionIdentity = useRef<{
        key: string;
        id: string;
    } | null>(null);
    const workflowRequest = useRef<AbortController | null>(null), workflowRevision = useRef(0);
    const [tours, setTours] = useState<Tour[]>([]);
    const [outcomeNotice, setOutcomeNotice] = useState<string | null>(null);
    const [toursError, setToursError] = useState<string | null>(null);
    const [toursLoading, setToursLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'details' | 'tours' | 'conversations' | 'activity' | 'automation'>('details');
    const [showSendMessage, setShowSendMessage] = useState(false);
    const [showScheduleTour, setShowScheduleTour] = useState(false);
    const [bookingContext, setBookingContext] = useState<import('@/utils/services/console-tour-booking').BookingContext | null>(null);
    const [showEditLead, setShowEditLead] = useState(false);
    const leadId = lead?.id;
    const tourReadRequest = useRef<AbortController | null>(null);
    const fetchTours = useCallback(async () => {
        if (!leadId)
            return;
        tourReadRequest.current?.abort();
        const controller = new AbortController();
        tourReadRequest.current = controller;
        setToursLoading(true);
        setToursError(null);
        setBookingContext(null);
        try {
            const response = await fetch(`/api/leads/${leadId}/tours`, { signal: controller.signal });
            if (!response.ok)
                throw new Error('Tour records could not be loaded.');
            const data = await response.json();
            if (!controller.signal.aborted) {
                setTours(data.tours || []);
                setBookingContext(data.bookingContext ?? null);
            }
        }
        catch {
            if (!controller.signal.aborted)
                setToursError('Tour records could not be loaded. Please retry.');
        }
        finally {
            if (!controller.signal.aborted)
                setToursLoading(false);
        }
    }, [leadId]);
    // Independent drawer reads must not start another tour load after editing begins.
    useEffect(() => {
        if (!leadId)
            return;
        const revision = ++workflowRevision.current;
        workflowActionIdentity.current = null;
        setWorkflow(null);
        setWorkflowError('');
        setWorkflowBusy(false);
        setWorkflowLoading(true);
        const controller = new AbortController();
        const read = async (url: string, receive: (data: Record<string, unknown>) => void) => {
            try {
                const response = await fetch(url, { signal: controller.signal });
                if (!response.ok) {
                    if (url.endsWith('/workflow'))
                        throw new Error('Workflow could not be loaded');
                    return;
                }
                const data = await response.json();
                if (!controller.signal.aborted)
                    receive(data);
            }
            catch (error) {
                if (!controller.signal.aborted) {
                    console.error('Lead detail could not be loaded:', error);
                    if (url.endsWith('/workflow'))
                        setWorkflowError('Workflow could not be loaded. Refresh to try again.');
                }
            }
            finally {
                if (!controller.signal.aborted && url.endsWith('/workflow') && workflowRevision.current === revision)
                    setWorkflowLoading(false);
            }
        };
        void Promise.all([
            fetchTours(),
            read(`/api/leads/${leadId}/workflow`, data => {
                if (workflowRevision.current === revision)
                    setWorkflow(data.workflow as Workflow | null);
            }),
        ]);
        return () => { controller.abort(); tourReadRequest.current?.abort(); workflowRequest.current?.abort(); };
    }, [leadId, propertyId, fetchTours]);
    const handleOutcomeSaved = (result: SavedTourOutcome) => {
        if (!lead)
            return;
        tourReadRequest.current?.abort();
        setToursLoading(false);
        setTours(previous => previous.map(tour => tour.id === result.tour.id ? { ...tour, status: result.tour.status, outcome_notes: result.tour.outcome_notes, correction: result.tour.correction } : tour));
        const followup = result.followup === 'configured' ? 'Configured follow-ups are queued; delivery is not yet confirmed.'
            : result.followup === 'not_configured' ? 'No follow-up workflow is configured for this outcome.'
                : result.followup === 'legacy' ? 'This outcome was already recorded; no follow-up was restarted.'
                    : 'Follow-ups were held because the tour timing or current lead state is not eligible.';
        setOutcomeNotice(`${result.correction ? 'No-show corrected to completed. Queued no-show follow-ups were stopped.' : 'Tour outcome saved.'} ${followup}`);
        if (result.leadStatus && result.leadStatus in STATUS_CONFIG)
            onOutcomeStatusSaved(lead.id, result.leadStatus as Lead['status']);
    };
    const handleScheduleSaved = (result: ScheduleResult) => {
        if (!lead || !result.tour)
            return;
        setTours(previous => previous.map(tour => tour.id === result.tour!.id ? { ...tour, ...result.tour!, status: result.tour!.status as Tour['status'], notes: result.tour!.notes || undefined } : tour));
        setOutcomeNotice(`Tour ${result.tour.status === 'cancelled' ? 'cancelled' : 'rescheduled'}. ${result.queued ? 'Calendar or prospect updates are queued; delivery is pending.' : 'No external updates were queued.'}`);
        if (result.leadStatus && result.leadStatus in STATUS_CONFIG)
            onOutcomeStatusSaved(lead.id, result.leadStatus as Lead['status']);
        void fetchTours();
    };
    const refreshWorkflow = async () => {
        if (!leadId)
            return;
        workflowActionIdentity.current = null;
        workflowRequest.current?.abort();
        const controller = new AbortController();
        workflowRequest.current = controller;
        ++workflowRevision.current;
        try {
            const response = await fetch(`/api/leads/${leadId}/workflow`, { signal: controller.signal });
            const data = await response.json();
            if (!response.ok)
                throw new Error(data.error || 'Workflow could not be loaded');
            if (!controller.signal.aborted) {
                setWorkflow(data.workflow);
                setWorkflowError('');
                setWorkflowLoading(false);
            }
        }
        catch (e) {
            if (!controller.signal.aborted)
                setWorkflowError(e instanceof Error ? e.message : 'Workflow could not be loaded');
        }
    };
    const handleWorkflowAction = async (action: 'pause' | 'resume' | 'stop') => {
        if (!leadId || !workflow || workflowBusy)
            return;
        workflowRequest.current?.abort();
        const controller = new AbortController();
        workflowRequest.current = controller;
        ++workflowRevision.current;
        setWorkflowBusy(true);
        setWorkflowError('');
        const key = `${workflow.id}/${action}`;
        if (workflowActionIdentity.current?.key !== key)
            workflowActionIdentity.current = { key, id: crypto.randomUUID() };
        try {
            const response = await fetch(`/api/leads/${leadId}/workflow`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, workflowId: workflow.id, requestId: workflowActionIdentity.current.id }), signal: controller.signal });
            const data = await response.json();
            if (!response.ok)
                throw new Error(data.error || 'Workflow change was not confirmed');
            if (!controller.signal.aborted) {
                workflowActionIdentity.current = null;
                setWorkflow(current => current ? { ...current, ...data.workflow, ...(current.action_visibility ? { action_visibility: { ...current.action_visibility, counts: { ...current.action_visibility.counts, paused: data.workflow.status === 'paused' ? 1 : 0 } } } : {}) } : current);
                setWorkflowBusy(false);
            }
        }
        catch (e) {
            if (!controller.signal.aborted) {
                setWorkflowError(e instanceof Error && !(e instanceof TypeError) ? e.message : 'The change is unconfirmed. Retry the same action safely.');
                setWorkflowBusy(false);
            }
        }
    };
    useEffect(() => {
        if (controller.notice)
            void refreshWorkflow();
        // Recorded lead decisions can start or stop follow-up without changing the drawer.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [controller.notice]);
    if (!lead)
        return null;
    return (<>
      <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40" onClick={onClose}/>
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 overflow-y-auto animate-in slide-in-from-right duration-300">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-semibold text-slate-900">Lead Details</h2>
          <div className="flex items-center gap-2">
            <button disabled={controller.busy || !!controller.pending || !controller.canManage} onClick={() => setShowEditLead(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors">
              <Settings size={16}/>
              Edit
            </button>
            <button onClick={onClose} aria-label="Close lead details" className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
              <X size={20} className="text-slate-500"/>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Lead Header */}
          <div className="flex items-start gap-4">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-indigo-500/20">
              {lead.first_name[0]}{lead.last_name[0]}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-semibold text-slate-900">
                  {lead.first_name} {lead.last_name}
                </h3>
                <ScoreBadge score={lead.score} bucket={lead.score_bucket}/>
              </div>
              <p className="text-slate-500">{lead.source}</p>
              <div className="mt-2">
                <StatusBadge status={lead.status}/>
              </div>
            </div>
          </div>

          <LeadRecordRecovery controller={controller}/>
          {/* Tabs */}
          <div className="flex flex-wrap gap-1 p-1 bg-slate-100 rounded-lg">
            {(['details', 'tours', 'conversations', 'activity', 'automation'] as const).map(tab => (<button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-all ${activeTab === tab
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'}`}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                {tab === 'tours' && tours.filter(t => t.status === 'scheduled' || t.status === 'confirmed').length > 0 && (<span className="ml-1.5 inline-flex items-center justify-center h-5 w-5 text-xs font-bold bg-purple-100 text-purple-700 rounded-full">
                    {tours.filter(t => t.status === 'scheduled' || t.status === 'confirmed').length}
                  </span>)}
              </button>))}
          </div>

          {activeTab === 'details' && (<>
              {/* Contact Info */}
              <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                <h4 className="text-sm font-medium text-slate-700 mb-3">Contact Information</h4>
                
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 bg-white rounded-lg flex items-center justify-center shadow-sm">
                    <Mail size={16} className="text-slate-500"/>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Email</p>
                    {lead.email ? (<a href={`mailto:${lead.email}`} className="text-sm font-medium text-slate-900 hover:text-indigo-600">
                        {lead.email}
                      </a>) : (<span className="text-sm text-slate-400">Not provided</span>)}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 bg-white rounded-lg flex items-center justify-center shadow-sm">
                    <Phone size={16} className="text-slate-500"/>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Phone</p>
                    {lead.phone ? (<a href={`tel:${lead.phone}`} className="text-sm font-medium text-slate-900 hover:text-indigo-600">
                        {lead.phone}
                      </a>) : (<span className="text-sm text-slate-400">Not provided</span>)}
                  </div>
                </div>

                {lead.bedrooms && (<div className="flex items-center gap-3">
                    <div className="h-9 w-9 bg-white rounded-lg flex items-center justify-center shadow-sm">
                      <BedDouble size={16} className="text-slate-500"/>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Looking for</p>
                      <p className="text-sm font-medium text-slate-900">{lead.bedrooms}</p>
                    </div>
                  </div>)}

                {lead.move_in_date && (<div className="flex items-center gap-3">
                    <div className="h-9 w-9 bg-white rounded-lg flex items-center justify-center shadow-sm">
                      <Calendar size={16} className="text-slate-500"/>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Move-in Date</p>
                      <p className="text-sm font-medium text-slate-900">
                        {format(new Date(lead.move_in_date), 'MMM d, yyyy')}
                      </p>
                    </div>
                  </div>)}

                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 bg-white rounded-lg flex items-center justify-center shadow-sm">
                    <Clock size={16} className="text-slate-500"/>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Created</p>
                    <p className="text-sm font-medium text-slate-900">
                      {format(new Date(lead.created_at), 'MMM d, yyyy \'at\' h:mm a')}
                    </p>
                  </div>
                </div>
              </div>

              {lead.notes && (<div className="bg-slate-50 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText size={16} className="text-slate-500"/>
                    <h4 className="text-sm font-medium text-slate-700">Notes</h4>
                  </div>
                  <p className="text-sm text-slate-600">{lead.notes}</p>
                </div>)}

              {/* Status Update */}
              <div>
                <h4 className="text-sm font-medium text-slate-700 mb-3">Update Status</h4>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(STATUS_CONFIG).map(([key, config]) => {
                const Icon = config.icon;
                const isActive = lead.status === key;
                return (<button key={key} disabled={controller.busy || !!controller.pending || !controller.canManage} onClick={() => onStatusChange(lead.id, key as Lead['status'])} className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${isActive
                        ? config.color + ' ring-2 ring-offset-2 ring-indigo-500'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                        <Icon size={16}/>
                        {config.label}
                      </button>);
            })}
                </div>
              </div>

              {/* Quick Actions */}
              <div>
                <h4 className="text-sm font-medium text-slate-700 mb-3">Quick Actions</h4>
                <div className="space-y-2">
                  <button onClick={() => setShowSendMessage(true)} disabled={!lead.email && !lead.phone} className="flex items-center gap-3 w-full px-4 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20">
                    <Send size={18}/>
                    <span className="font-medium">Send Message</span>
                  </button>
                  {lead.phone && (<a href={`tel:${lead.phone}`} className="flex items-center gap-3 w-full px-4 py-3 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 transition-colors">
                      <Phone size={18}/>
                      <span className="font-medium">Call Lead</span>
                    </a>)}
                  <button disabled={toursLoading || !bookingContext} onClick={() => setShowScheduleTour(true)} className="flex items-center gap-3 w-full px-4 py-3 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 transition-colors">
                    <Calendar size={18}/>
                    <span className="font-medium">Schedule Tour</span>
                  </button>
                </div>
              </div>

              {/* Upcoming Tours Preview */}
              {tours.filter(t => t.status === 'scheduled' || t.status === 'confirmed').length > 0 && (<div className="bg-purple-50 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-medium text-purple-900 flex items-center gap-2">
                      <Calendar size={16}/>
                      Upcoming Tours
                    </h4>
                    <button onClick={() => setActiveTab('tours')} className="text-xs text-purple-600 hover:text-purple-700 font-medium">
                      View all →
                    </button>
                  </div>
                  <div className="space-y-2">
                    {tours
                    .filter(t => t.status === 'scheduled' || t.status === 'confirmed')
                    .slice(0, 2)
                    .map(tour => (<div key={tour.id} className="bg-white rounded-lg px-3 py-2 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`p-1.5 rounded ${TOUR_TYPE_CONFIG[tour.tour_type].color}`}>
                              {(() => {
                        const Icon = TOUR_TYPE_CONFIG[tour.tour_type].icon;
                        return <Icon size={12}/>;
                    })()}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-slate-900">
                                {format(parseISO(tour.tour_date), 'MMM d')}
                              </p>
                              <p className="text-xs text-slate-500">
                                {format(new Date(`2000-01-01T${tour.tour_time}`), 'h:mm a')}
                              </p>
                            </div>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded ${TOUR_STATUS_CONFIG[tour.status].color}`}>
                            {TOUR_STATUS_CONFIG[tour.status].label}
                          </span>
                        </div>))}
                  </div>
                </div>)}
            </>)}

          {activeTab === 'tours' && (<div className="space-y-4">
              <TourReminderHistory key={lead.id} leadId={lead.id}/>
              <TourScheduleDeliveryHistory key={`schedule-${lead.id}`} leadId={lead.id} onSaved={() => void fetchTours()}/>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-slate-700">Scheduled Tours</h4>
                <button disabled={toursLoading || !bookingContext} onClick={() => setShowScheduleTour(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 transition-colors">
                  <Plus size={14}/>
                  New Tour
                </button>
              </div>

              {outcomeNotice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{outcomeNotice}</p>}
              {toursError ? <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{toursError} <button type="button" onClick={fetchTours} className="underline">Retry tours</button></div>
                : toursLoading ? <p role="status" className="text-sm text-slate-500">Loading tour records…</p>
                    : tours.length === 0 ? (<div className="bg-slate-50 rounded-xl p-6 text-center">
                  <Calendar className="mx-auto text-slate-300 mb-3" size={32}/>
                  <p className="text-sm text-slate-600 font-medium mb-1">No tours scheduled</p>
                  <p className="text-xs text-slate-500 mb-4">
                    Schedule a tour to help this lead find their perfect home.
                  </p>
                  <button disabled={toursLoading || !bookingContext} onClick={() => setShowScheduleTour(true)} className="inline-flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors">
                    <Calendar size={16}/>
                    Schedule Tour
                  </button>
                </div>) : (<div className="space-y-3">
                  {/* Active Tours */}
                  {tours.filter(t => t.status === 'scheduled' || t.status === 'confirmed').length > 0 && (<div>
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Active tours</p>
                      <div className="space-y-2">
                        {tours
                                .filter(t => t.status === 'scheduled' || t.status === 'confirmed')
                                .map(tour => (<TourCard key={tour.id} tour={tour} leadId={lead.id} onOutcomeSaved={handleOutcomeSaved} onScheduleSaved={handleScheduleSaved}/>))}
                      </div>
                    </div>)}

                  {/* Past Tours */}
                  {tours.filter(t => t.status === 'completed' || t.status === 'cancelled' || t.status === 'no_show').length > 0 && (<div>
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2 mt-4">Past Tours</p>
                      <div className="space-y-2">
                        {tours
                                .filter(t => t.status === 'completed' || t.status === 'cancelled' || t.status === 'no_show')
                                .map(tour => (<TourCard key={tour.id} tour={tour} leadId={lead.id} onOutcomeSaved={handleOutcomeSaved}/>))}
                      </div>
                    </div>)}
                </div>)}
            </div>)}

          {activeTab === 'conversations' && <LumaConversationInbox key={lead.id} propertyId={propertyId} leadId={lead.id}/>}

          {activeTab === 'activity' && (<div>
              <LeadRecordHistory leadId={lead.id} controller={controller}/>
              <h4 className="text-sm font-medium text-slate-700 mb-3">Activity Timeline</h4>
              <ActivityTimeline key={`${propertyId}:${lead.id}`} propertyId={propertyId} leadId={lead.id}/>
            </div>)}

          {activeTab === 'automation' && (<div>
              <LeadFollowupControls lead={lead} controller={controller}/>
              <h4 className="text-sm font-medium text-slate-700 mb-3">Workflow Automation</h4>
              {workflowLoading ? <p className="text-sm text-slate-500">Loading workflow…</p> : (workflow || !workflowError) && <WorkflowStatus workflow={workflow} onAction={handleWorkflowAction} busy={workflowBusy}/>}
              {workflowError && <p role="alert" className="mt-2 text-sm text-red-700">{workflowError} <button className="underline" onClick={() => void refreshWorkflow()}>Refresh workflow</button></p>}
              <WorkflowDeliveryHistory key={lead.id} leadId={lead.id} onSaved={() => void refreshWorkflow()}/>
            </div>)}
        </div>
      </div>

      {/* Send Message Modal */}
      {showSendMessage && (<SendMessageModal isOpen={showSendMessage} onClose={() => setShowSendMessage(false)} lead={lead} propertyId={propertyId} onSent={() => setActiveTab('conversations')}/>)}

      {/* Tour Schedule Modal */}
      {/*
                    TourScheduleModal uses a narrower Lead shape where optional contact fields are
                    undefined (not null). Adapt here to keep types strict and avoid null mismatch.
                  */}
      {(() => {
            const tourLead: TourLead = {
                id: lead.id,
                first_name: lead.first_name,
                last_name: lead.last_name,
                email: lead.email || undefined,
                phone: lead.phone || undefined,
                property_id: lead.property_id
            };
            return (<>{showScheduleTour && <TourScheduleModal key={lead.id} context={bookingContext} onClose={() => {
                        setShowScheduleTour(false);
                    }} lead={tourLead} onScheduled={result => {
                        void fetchTours();
                        if (result.leadStatus && result.leadStatus in STATUS_CONFIG)
                            onOutcomeStatusSaved(lead.id, result.leadStatus as Lead['status']);
                    }}/>}</>);
        })()}

      {/* Edit Lead Modal */}
      {showEditLead && (<LeadRecordEditor controller={controller} onClose={() => setShowEditLead(false)} lead={lead} onSaved={() => { }}/>)}
    </>);
}
export default function LeadsPage() {
    const { currentProperty } = usePropertyContext();
    return <LeadsWorkspace key={currentProperty?.id || 'loading'}/>;
}
function LeadsWorkspace() {
    const { currentProperty } = usePropertyContext();
    const leadRequest = useRef<AbortController | null>(null);
    const [data, setData] = useState<LeadsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // Filters
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [sourceFilter, setSourceFilter] = useState<string>('all');
    const [page, setPage] = useState(1);
    // Selected lead for drawer
    const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
    // Create lead modal
    const [showCreateModal, setShowCreateModal] = useState(false);
    // Bulk CRM sync
    const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
    const [syncingToCRM, setSyncingToCRM] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);
    const [syncResult, setSyncResult] = useState<Awaited<ReturnType<typeof syncLeadBatch>> | null>(null);
    const syncBusy = useRef(false);
    const fetchLeads = useCallback(async () => {
        if (!currentProperty?.id)
            return;
        leadRequest.current?.abort();
        const controller = new AbortController();
        leadRequest.current = controller;
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({
                propertyId: currentProperty.id,
                page: page.toString(),
                limit: '25',
                sortBy: 'updated_at',
                sortOrder: 'desc',
                ...(statusFilter !== 'all' && { status: statusFilter }),
                ...(sourceFilter !== 'all' && { source: sourceFilter }),
                ...(search && { search }),
            });
            const response = await fetch(`/api/leads?${params}`, { signal: controller.signal });
            if (!response.ok) {
                const errBody = await response.json().catch(() => ({}));
                throw new Error(errBody?.error || `Failed to fetch leads (${response.status})`);
            }
            const result = await response.json();
            if (!controller.signal.aborted)
                setData(result);
        }
        catch (err) {
            if (controller.signal.aborted)
                return;
            console.error('Error fetching leads:', err);
            setError(err instanceof Error ? err.message : 'Failed to load leads');
        }
        finally {
            if (!controller.signal.aborted)
                setLoading(false);
        }
    }, [currentProperty?.id, page, statusFilter, sourceFilter, search]);
    useEffect(() => {
        void fetchLeads();
        return () => leadRequest.current?.abort();
    }, [fetchLeads]);
    useEffect(()=>{const id=new URL(window.location.href).searchParams.get('lead');if(!currentProperty.id||!id||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id))return;const controller=new AbortController();void(async()=>{try{const response=await fetch('/api/leads?'+new URLSearchParams({propertyId:currentProperty.id,kind:'lead',id}),{cache:'no-store',signal:controller.signal});const result=await response.json();if(!response.ok||!result.lead||result.lead.property_id!==currentProperty.id)throw new Error('The selected lead is unavailable in this property.');if(!controller.signal.aborted)setSelectedLead(result.lead)}catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:'The selected lead could not be loaded.')}})();return()=>controller.abort()},[currentProperty.id]);
    const applyLead = useCallback((updated: Lead) => {
        setSelectedLead(previous => previous?.id === updated.id ? updated : previous);
        setData(previous => previous ? { ...previous, leads: previous.leads.map(item => item.id === updated.id ? updated : item) } : previous);
        void fetchLeads();
    }, [fetchLeads]);
    const recordController = useLeadRecords(currentProperty?.id || '', applyLead);
    const handleStatusChange = async (leadId: string, newStatus: Lead['status']) => {
        const shown = selectedLead?.id === leadId ? selectedLead : data?.leads.find(item => item.id === leadId);
        if (!shown)
            return;
        await recordController.execute({ operation: 'status', leadId, revision: shown.record_revision, status: newStatus, reason: '' });
    };
    const refreshCurrentLead = async (leadId: string) => {
        // Tour operations own their mutation; read the resulting revision instead of posting another status.
        try {
            const result = await recordController.read({ kind: 'lead', id: leadId });
            if (result.lead)
                applyLead(result.lead);
        }
        catch {
            setError('The tour change was saved, but current lead details could not be refreshed. Refresh before editing this lead.');
        }
    };
    const totalLeads = data?.pagination.total || 0;
    const statusSummary = data?.statusSummary || {};
    const handleBulkSyncToCRM = async () => {
        if (!currentProperty?.id || !selectedLeads.size || syncBusy.current || !recordController.canManage) return;
        syncBusy.current = true;
        setSyncingToCRM(true);
        setSyncError(null);
        setSyncResult(null);
        try {
            const result = await syncLeadBatch(currentProperty.id, Array.from(selectedLeads));
            setSyncResult(result);
            setSelectedLeads(new Set());
        } catch (err) {
            setSyncError(err instanceof Error ? err.message : 'CRM sync could not be confirmed. Try again to check the same request.');
        } finally {
            syncBusy.current = false;
            setSyncingToCRM(false);
        }
    };
    const toggleLeadSelection = (leadId: string) => {
        const newSelected = new Set(selectedLeads);
        if (newSelected.has(leadId)) {
            newSelected.delete(leadId);
        }
        else {
            newSelected.add(leadId);
        }
        setSelectedLeads(newSelected);
    };
    const toggleSelectAll = () => {
        if (selectedLeads.size === data?.leads.length) {
            setSelectedLeads(new Set());
        }
        else {
            setSelectedLeads(new Set(data?.leads.map(l => l.id) || []));
        }
    };
    // Get unsynced leads (pending, retrying, failed, or dead-lettered)
    const unsyncedLeads = data?.leads.filter(l => !l.external_crm_id ||
        l.crm_sync_status === 'pending' ||
        l.crm_sync_status === 'retrying' ||
        l.crm_sync_status === 'failed' ||
        l.crm_sync_status === 'dead_lettered') || [];
    return (<div className="space-y-6">
      {!selectedLead && !showCreateModal && <LeadRecordRecovery controller={recordController}/>}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="text-amber-500" size={24}/>
            TourSpark
          </h1>
          <p className="text-slate-500 mt-1">
            Lead management & automated follow-ups for {currentProperty?.name || 'your property'}
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          {selectedLeads.size > 0 && (<button onClick={handleBulkSyncToCRM} disabled={syncingToCRM || !recordController.canManage} className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors shadow-lg shadow-teal-500/20 disabled:opacity-50">
              {syncingToCRM ? (<>
                  <Loader2 size={16} className="animate-spin"/>
                  Syncing...
                </>) : (<>
                  <Upload size={16}/>
                  Sync to CRM ({selectedLeads.size})
                </>)}
            </button>)}
          <button onClick={fetchLeads} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''}/>
            Refresh
          </button>
          <button disabled={recordController.busy || !!recordController.pending || !recordController.canManage} onClick={() => setShowCreateModal(true)} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-500/20">
            <Plus size={16}/>
            Add Lead
          </button>
        </div>
      </div>

      {/* Status Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {Object.entries(STATUS_CONFIG).map(([key, config]) => {
            const Icon = config.icon;
            const count = statusSummary[key] || 0;
            return (<button key={key} onClick={() => setStatusFilter(statusFilter === key ? 'all' : key)} className={`p-4 rounded-xl border transition-all ${statusFilter === key
                    ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500/20'
                    : 'border-slate-200 bg-white hover:border-slate-300'}`}>
              <div className="flex items-center gap-2 mb-1">
                <Icon size={16} className={statusFilter === key ? 'text-indigo-600' : 'text-slate-400'}/>
                <span className={`text-sm font-medium ${statusFilter === key ? 'text-indigo-600' : 'text-slate-600'}`}>
                  {config.label}
                </span>
              </div>
              <p className={`text-2xl font-bold ${statusFilter === key ? 'text-indigo-600' : 'text-slate-900'}`}>
                {count}
              </p>
            </button>);
        })}
      </div>

      {syncResult && <div role="status" className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-blue-900">
        <p>{syncResult.message}</p>
        {syncResult.issues.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm">{syncResult.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
      </div>}

      {syncError && <div role="alert" className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-900">
        <p className="font-medium">CRM sync needs attention</p>
        <p className="text-sm">{syncError}</p>
        <a href="/dashboard/settings/crm" className="underline text-sm">View sync details</a>
      </div>}

      {/* CRM Sync Info */}
      {unsyncedLeads.length > 0 && (<div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <Database className="text-amber-600 flex-shrink-0 mt-0.5" size={20}/>
              <div>
                <p className="font-medium text-amber-900">
                  {unsyncedLeads.length} lead{unsyncedLeads.length !== 1 ? 's' : ''} with pending CRM activity
                </p>
                <p className="text-sm text-amber-700 mt-1">
                  Select leads and click Sync to CRM. Existing CRM contacts will not be duplicated.
                </p>
              </div>
            </div>
            <button onClick={() => {
                const unsyncedIds = unsyncedLeads.map(l => l.id);
                setSelectedLeads(new Set(unsyncedIds));
            }} className="text-sm text-amber-700 hover:text-amber-900 font-medium whitespace-nowrap">
              Select All Unsynced
            </button>
          </div>
        </div>)}

      {/* Filters Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
            <input type="text" placeholder="Search leads by name, email, or phone..." value={search} onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
        }} className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"/>
          </div>

          {/* Source Filter */}
          <div className="relative">
            <select value={sourceFilter} onChange={(e) => {
            setSourceFilter(e.target.value);
            setPage(1);
        }} className="appearance-none pl-4 pr-10 py-2.5 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer">
              <option value="all">All Sources</option>
              {data?.filters.sources.map(source => (<option key={source} value={source}>{source}</option>))}
            </select>
            <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
          </div>

          {/* Clear Filters */}
          {(statusFilter !== 'all' || sourceFilter !== 'all' || search) && (<button onClick={() => {
                setStatusFilter('all');
                setSourceFilter('all');
                setSearch('');
                setPage(1);
            }} className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 hover:text-slate-900">
              <X size={16}/>
              Clear filters
            </button>)}
        </div>
      </div>

      {/* Leads Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {error ? (<div className="p-12 text-center">
            <div className="h-12 w-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <X className="text-red-500" size={24}/>
            </div>
            <p className="text-slate-900 font-medium mb-1">Error loading leads</p>
            <p className="text-slate-500 text-sm">{error}</p>
          </div>) : loading && !data ? (<div className="p-12 text-center">
            <div className="animate-spin h-8 w-8 border-4 border-indigo-500 border-t-transparent rounded-full mx-auto mb-4"/>
            <p className="text-slate-500">Loading leads...</p>
          </div>) : data?.leads.length === 0 ? (<div className="p-12 text-center">
            <div className="h-12 w-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <User className="text-slate-400" size={24}/>
            </div>
            <p className="text-slate-900 font-medium mb-1">No leads found</p>
            <p className="text-slate-500 text-sm mb-4">
              {search || statusFilter !== 'all' || sourceFilter !== 'all'
                ? 'Try adjusting your filters'
                : 'Get started by adding your first lead'}
            </p>
            {!(search || statusFilter !== 'all' || sourceFilter !== 'all') && (<button disabled={recordController.busy || !!recordController.pending || !recordController.canManage} onClick={() => setShowCreateModal(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                <Plus size={16}/>
                Add Lead
              </button>)}
          </div>) : (<>
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left w-12">
                    <input type="checkbox" checked={selectedLeads.size === data?.leads.length && data?.leads.length > 0} onChange={toggleSelectAll} className="w-4 h-4 text-teal-600 border-slate-300 rounded focus:ring-teal-500 cursor-pointer"/>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Lead
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Source
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Phone
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Last Touch
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-12">
                  </th>
                </tr>
              </thead>
              <tbody>
                {data?.leads.map(lead => (<LeadRow key={lead.id} lead={lead} canManage={recordController.canManage && !recordController.busy && !recordController.pending} onStatusChange={handleStatusChange} onSelect={setSelectedLead} isSelected={selectedLeads.has(lead.id)} onToggleSelect={toggleLeadSelection}/>))}
              </tbody>
            </table>

            {/* Pagination */}
            {data && data.pagination.totalPages > 1 && (<div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between">
                <p className="text-sm text-slate-500">
                  Showing {((page - 1) * 25) + 1} to {Math.min(page * 25, totalLeads)} of {totalLeads} leads
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed">
                    <ChevronLeft size={18}/>
                  </button>
                  <span className="text-sm text-slate-600">
                    Page {page} of {data.pagination.totalPages}
                  </span>
                  <button onClick={() => setPage(p => Math.min(data.pagination.totalPages, p + 1))} disabled={page === data.pagination.totalPages} className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed">
                    <ChevronRight size={18}/>
                  </button>
                </div>
              </div>)}
          </>)}
      </div>

      {/* Lead Detail Drawer */}
      <LeadDetailDrawer key={`${currentProperty?.id}/${selectedLead?.id}`} lead={selectedLead?.property_id === currentProperty?.id ? selectedLead : null} onClose={() => setSelectedLead(null)} onStatusChange={handleStatusChange} controller={recordController} onOutcomeStatusSaved={(leadId) => void refreshCurrentLead(leadId)} propertyId={currentProperty?.id || ''}/>

      {/* Create Lead Modal */}
      {showCreateModal && <LeadRecordEditor controller={recordController} onClose={() => setShowCreateModal(false)} onSaved={() => { }}/>}
    </div>);
}
