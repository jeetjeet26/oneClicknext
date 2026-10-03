'use client';
export function AuditEvidence({ value }: {
    value: unknown;
}) {
    if (value == null)
        return <span className="text-muted-foreground">Not recorded</span>;
    if (Array.isArray(value))
        return <ul className="space-y-2">{value.map((v, i) => <li key={i}><AuditEvidence value={v}/></li>)}</ul>;
    if (typeof value === 'object')
        return <dl className="space-y-2">{Object.entries(value).map(([k, v]) => <div key={k}><dt className="text-xs text-muted-foreground">{k.replaceAll('_', ' ')}</dt><dd className="whitespace-pre-wrap break-words"><AuditEvidence value={v}/></dd></div>)}</dl>;
    return <span className="whitespace-pre-wrap break-words">{typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}</span>;
}
