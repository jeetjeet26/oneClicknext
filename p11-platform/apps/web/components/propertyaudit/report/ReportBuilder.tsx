"use client";
import { X } from 'lucide-react';
import { RetainedAuditReports } from './RetainedAuditReports';
import type { AuditReportOptions } from '@/utils/propertyaudit/report-contracts';
import type { Surface } from '@/utils/propertyaudit/types';
export type ReportTemplate = AuditReportOptions['template'];
export function ReportBuilder({ isOpen, onClose, propertyId, propertyName, runId, batchId, initialFormat }: {
    isOpen: boolean;
    onClose: () => void;
    propertyId: string;
    propertyName: string;
    runId: string | null;
    batchId?: string | null;
    runSummary?: {
        surface: Surface;
        startedAt: string;
    } | null;
    initialFormat?: AuditReportOptions['format'];
}) {
    if (!isOpen)
        return null;
    return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"><div role="dialog" aria-modal="true" aria-label="Audit reports and exports" className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl border bg-white p-4 dark:bg-gray-900 sm:p-6"><div className="sticky top-0 z-10 mb-5 flex items-start justify-between gap-3 bg-white pb-3 dark:bg-gray-900"><div><h2 className="text-xl font-semibold">Audit reports and exports</h2><p className="text-sm text-gray-500">{propertyName}</p></div><button aria-label="Close report workspace" onClick={onClose}><X className="h-5 w-5"/></button></div><RetainedAuditReports key={propertyId} propertyId={propertyId} runId={runId} batchId={batchId} initialFormat={initialFormat}/></div></div>;
}
