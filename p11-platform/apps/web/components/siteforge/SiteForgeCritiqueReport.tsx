import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type {
  AestheticCritiqueSeverity,
  RenderedAestheticCritiqueReport,
} from '@/utils/siteforge/critique/contracts'

function severityVariant(
  severity: AestheticCritiqueSeverity
): 'destructive' | 'default' | 'secondary' | 'outline' {
  if (severity === 'blocker') return 'destructive'
  if (severity === 'major') return 'default'
  if (severity === 'moderate') return 'secondary'
  return 'outline'
}

function shortDigest(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-8)}`
}

export function SiteForgeCritiqueReport({
  report,
}: {
  report: RenderedAestheticCritiqueReport
}) {
  return (
    <section className="space-y-4" aria-labelledby="siteforge-critique-title">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle id="siteforge-critique-title">
              Rendered aesthetic critique
            </CardTitle>
            {report.highestSeverity ? (
              <Badge variant={severityVariant(report.highestSeverity)}>
                {report.highestSeverity}
              </Badge>
            ) : (
              <Badge variant="success">No findings</Badge>
            )}
            <Badge
              variant={
                report.provider.status === 'succeeded'
                  ? 'success'
                  : 'secondary'
              }
            >
              visual provider {report.provider.status}
            </Badge>
          </div>
          <CardDescription>
            Screenshot-bound findings for artifact{' '}
            <span className="font-mono">
              {shortDigest(report.binding.artifactId)}
            </span>
            . Repairs remain pending semantic proposals and are never applied by
            this report.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-gray-500">Content hash</p>
            <p className="mt-1 font-mono">
              {shortDigest(report.binding.contentHash)}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Evidence digest</p>
            <p className="mt-1 font-mono">
              {shortDigest(report.binding.evidenceDigest)}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Findings</p>
            <p className="mt-1 text-sm font-semibold">
              {report.findings.length}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Pending proposals</p>
            <p className="mt-1 text-sm font-semibold">
              {report.proposals.length}
            </p>
          </div>
        </CardContent>
      </Card>

      {report.provider.status === 'failed' ? (
        <div
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
        >
          Visual provider critique was unavailable. The report contains only
          deterministic, artifact-derived findings and checks.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {report.findings.map(finding => (
          <Card key={finding.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{finding.title}</CardTitle>
                <Badge variant={severityVariant(finding.severity)}>
                  {finding.severity}
                </Badge>
                <Badge variant="outline">
                  {finding.category.replaceAll('_', ' ')}
                </Badge>
              </div>
              <CardDescription>{finding.critique}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {finding.evidence.map(item => (
                  <li
                    key={`${item.screenshotIdentityDigest}:${item.observation}`}
                    className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
                  >
                    <p className="text-sm text-gray-800 dark:text-gray-100">
                      {item.observation}
                    </p>
                    <p className="mt-2 break-all font-mono text-xs text-gray-500">
                      {item.viewport} · {item.pageUrl} ·{' '}
                      {shortDigest(item.screenshotSha256)}
                    </p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Supervised repair proposals</CardTitle>
          <CardDescription>
            Manager or admin approval is required. Every approved change must
            rerun canonical preview and browser certification.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {report.proposals.length ? (
            <ul className="space-y-3">
              {report.proposals.map(proposal => (
                <li
                  key={proposal.id}
                  className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{proposal.summary}</p>
                    <Badge variant="default">approval pending</Badge>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    {proposal.operations.length} typed operation
                    {proposal.operations.length === 1 ? '' : 's'} · factual guard
                    required · no direct mutation
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">
              No bounded semantic repair passed proposal policy.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
