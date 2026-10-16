import type { ReactNode } from 'react'

/** Supporting detail stays available without competing with the task summary. */
export function WorkspaceDisclosure({ title, description, children, open, id }: {
  title: string
  description?: string
  children: ReactNode
  open?: boolean
  id?: string
}) {
  return <details id={id} className="workspace-disclosure" open={open}>
    <summary><span>{title}</span>{description && <span className="workspace-disclosure-description">{description}</span>}</summary>
    <div className="workspace-disclosure-body">{children}</div>
  </details>
}

export function WorkspaceNotice({ title, children, action, error = false }: {
  title: string
  children: ReactNode
  action?: ReactNode
  error?: boolean
}) {
  return <div className={error ? 'console-error workspace-notice' : 'workspace-notice'} role={error ? 'alert' : 'status'}>
    <div><p className="font-semibold">{title}</p><div className="mt-1 text-sm leading-relaxed">{children}</div></div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
}
