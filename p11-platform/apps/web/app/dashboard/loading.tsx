import { P11Logo } from '@/components/ui/P11Logo'

export default function DashboardLoading() {
  return <div role="status" className="flex min-h-[60vh] items-center justify-center gap-2 text-muted-foreground">
    <P11Logo className="console-loading-mark" />
    Loading workspace…
  </div>
}
