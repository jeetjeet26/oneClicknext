'use client';
import { useEffect, useState, useRef } from 'react';
import { Clock, Loader2 } from 'lucide-react';
import { getSurfaceLabel, type Surface } from '@/utils/propertyaudit/types';
interface RunStatusIndicatorProps {
    propertyId: string;
    onRunDetected?: () => void;
    onRunCompleted?: (runId: string) => void;
    pollInterval?: number;
}
interface ActiveRun {
    id: string;
    surface: Surface;
    status: 'queued' | 'running' | 'completed' | 'failed';
    queryCount: number;
    progressPct: number;
    currentQueryIndex: number;
    statusDetail: string;
    isPossiblyStalled: boolean;
    startedAt: string;
}
export function RunStatusIndicator({ propertyId, onRunDetected, onRunCompleted, pollInterval = 3000 }: RunStatusIndicatorProps) {
    const [activeRuns, setActiveRuns] = useState<ActiveRun[]>([]);
    const callbacks = useRef({ onRunDetected, onRunCompleted });
    const [error, setError] = useState('');
    useEffect(() => { callbacks.current = { onRunDetected, onRunCompleted }; }, [onRunDetected, onRunCompleted]);
    useEffect(() => {
        if (!propertyId)
            return;
        const abort = new AbortController(), completedRunIds = new Set<string>();
        let loading = false;
        const checkStatus = async () => {
            if (loading || abort.signal.aborted)
                return;
            loading = true;
            try {
                const res = await fetch(`/api/propertyaudit/runs?propertyId=${propertyId}&limit=5`, { signal: abort.signal, cache: 'no-store' });
                const data = await res.json();
                if (!res.ok)
                    throw new Error('Audit progress could not be refreshed. Saved history is still available.');
                if (abort.signal.aborted)
                    return;
                setError('');
                if (res.ok && data.runs) {
                    const running = data.runs.filter((r: ActiveRun) => r.status === 'queued' || r.status === 'running');
                    setActiveRuns(running);
                    // Detect newly running runs
                    if (running.length > 0 && callbacks.current.onRunDetected) {
                        callbacks.current.onRunDetected();
                    }
                    // Detect newly completed runs
                    const completed = data.runs.filter((r: ActiveRun) => r.status === 'completed' && !completedRunIds.has(r.id));
                    completed.forEach((run: ActiveRun) => {
                        completedRunIds.add(run.id);
                        if (callbacks.current.onRunCompleted) {
                            callbacks.current.onRunCompleted(run.id);
                        }
                    });
                }
            }
            catch (error) {
                if (!abort.signal.aborted)
                    setError(error instanceof Error ? error.message : 'Audit progress unavailable');
            }
            finally {
                loading = false;
            }
        };
        // Initial check
        checkStatus();
        // Set up polling
        const interval = setInterval(checkStatus, pollInterval);
        return () => { abort.abort(); clearInterval(interval); };
    }, [propertyId, pollInterval]);
    if (error)
        return <p role="status" className="rounded border border-amber-500 p-3 text-sm">{error}</p>;
    if (activeRuns.length === 0) {
        return null;
    }
    return (<div className="space-y-2">
      {activeRuns.map((run) => (<div key={run.id} className="flex items-center gap-3 rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-900/20 px-4 py-3">
          {run.status === 'queued' && (<>
              <Clock className="w-5 h-5 text-indigo-500 animate-pulse"/>
              <div className="flex-1">
                <p className="text-sm font-medium text-indigo-900 dark:text-indigo-100">
                  Run queued for {getSurfaceLabel(run.surface)}
                </p>
                <p className="text-xs text-indigo-600 dark:text-indigo-400">
                  {run.statusDetail}
                </p>
              </div>
            </>)}
          {run.status === 'running' && (<>
              <Loader2 className="w-5 h-5 text-indigo-500 animate-spin"/>
              <div className="flex-1">
                <p className="text-sm font-medium text-indigo-900 dark:text-indigo-100">
                  Processing {getSurfaceLabel(run.surface)} audit...
                </p>
                <p className="text-xs text-indigo-600 dark:text-indigo-400">
                  {run.statusDetail}
                </p>
                <div className="mt-2 h-1.5 w-full rounded-full bg-indigo-100 dark:bg-indigo-950/50 overflow-hidden">
                  <div className={`h-full rounded-full ${run.isPossiblyStalled ? 'bg-amber-500' : 'bg-indigo-500'}`} style={{ width: `${Math.max(0, Math.min(100, run.progressPct || 0))}%` }}/>
                </div>
              </div>
            </>)}
        </div>))}
    </div>);
}
