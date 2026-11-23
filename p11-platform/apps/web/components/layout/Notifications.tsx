'use client'

import Link from 'next/link'
import { Bell } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export function Notifications() {
  const [open, setOpen] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    function dismiss(event: PointerEvent) {
      if (!panel.current?.contains(event.target as Node)) setOpen(false)
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  return <div ref={panel} className="relative" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }}>
    <button ref={trigger} type="button" aria-label="Notifications" aria-expanded={open}
      aria-controls="console-notifications" onClick={() => setOpen(!open)}
      className="grid size-11 place-items-center rounded-lg text-muted-foreground hover:bg-muted">
      <Bell size={20} aria-hidden="true" />
    </button>
    <section id="console-notifications" hidden={!open} aria-label="Notifications"
      className="absolute right-0 top-full z-50 mt-2 w-60 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg">
      <h2 className="font-semibold">Notifications</h2>
      <p className="my-2 text-sm text-muted-foreground">No new notifications.</p>
      <Link className="console-link underline" href="/dashboard/activity" onClick={() => setOpen(false)}>View activity history</Link>
    </section>
  </div>
}
