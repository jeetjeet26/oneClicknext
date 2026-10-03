// Phase 0 containment candidate. Deploy only after approval for this legacy endpoint.
// No secrets, database clients, queued work or remote websites are accessed.
Deno.serve(() => new Response(JSON.stringify({
  error: 'This legacy SiteForge endpoint is paused pending caller and property-access review.',
}), { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }))
