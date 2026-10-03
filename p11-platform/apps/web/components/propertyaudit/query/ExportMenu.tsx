"use client";
import { useState } from 'react';
import { ReportBuilder } from '../report/ReportBuilder';
export function ExportMenu({ propertyId, runId, onExportCSV }: {
    propertyId: string;
    runId: string | null;
    onExportCSV?: () => void;
}) { const [open, setOpen] = useState(false); return <><button className="rounded border px-3 py-2 text-sm" onClick={() => setOpen(true)}>Reports and exports</button>{onExportCSV && <button onClick={onExportCSV}>CSV options</button>}<ReportBuilder isOpen={open} onClose={() => setOpen(false)} propertyId={propertyId} propertyName="Selected property" runId={runId}/></>; }
