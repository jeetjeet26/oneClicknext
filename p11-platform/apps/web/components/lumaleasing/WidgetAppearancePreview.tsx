'use client'

type Appearance = {
  widget_name: string
  primary_color: string
  secondary_color: string
  welcome_message: string
  logo_url: string | null
  agent_avatar_url: string | null
}

export function WidgetAppearancePreview({ config }: { config: Appearance }) {
  const draft = {
    widgetName: config.widget_name,
    primaryColor: config.primary_color,
    secondaryColor: config.secondary_color,
    welcomeMessage: config.welcome_message,
    logoUrl: config.logo_url,
    agentAvatarUrl: config.agent_avatar_url,
  }
  const script = new URL('/lumaleasing.js', window.location.origin).href
  const policy = `default-src 'none'; script-src ${script}; style-src 'unsafe-inline'; img-src https: ${window.location.origin}; connect-src 'none'; form-action 'none'; base-uri 'none'`
  const document = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"></head><body><script data-appearance-preview="${encodeURIComponent(JSON.stringify(draft))}" src="${script}"></script></body></html>`
  return <section id="widget-appearance-preview" className="border-y border-border bg-muted p-4">
    <h3 className="font-semibold">Widget preview</h3>
    <p className="mb-3 text-sm text-muted-foreground">Your current edits appear here. Chats and bookings are disabled in this preview.</p>
    <p className="sr-only">{config.widget_name}. {config.welcome_message}</p>
    <iframe title="Widget appearance preview" sandbox="allow-scripts" referrerPolicy="no-referrer"
      className="mx-auto block h-[540px] w-full max-w-md rounded-lg border border-border bg-card" srcDoc={document} />
  </section>
}
