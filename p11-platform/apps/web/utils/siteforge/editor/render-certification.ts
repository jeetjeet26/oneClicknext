import { createHash } from 'node:crypto'
import { URL } from 'node:url'
import { Sandbox } from '@vercel/sandbox'
import { strToU8, zipSync } from 'fflate'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { certifyBrowserEvidence } from '@/utils/siteforge/verification/browser-certification'
import type { BrowserCertificationReport } from '@/utils/siteforge/verification/browser-evidence'

const ARTIFACT_BUCKET = 'siteforge-artifacts'

export interface OverlayRenderCertification {
  url: string
  correctionAttempt: 0 | 1
  desktopSha256: string
  mobileSha256: string
  accessibilitySha256: string
  evidenceStoragePath: string
  capturedAt: string
  browserReport: BrowserCertificationReport
}

function digest(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function run(
  sandbox: Awaited<ReturnType<typeof Sandbox.create>>,
  command: string,
  args: string[]
) {
  const result = await sandbox.runCommand(command, args)
  const stdout = await result.stdout()
  const stderr = await result.stderr()
  if (result.exitCode !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${stderr || stdout}`)
  }
  return stdout
}

async function screenshotPath(
  sandbox: Awaited<ReturnType<typeof Sandbox.create>>
): Promise<string> {
  const output = await run(sandbox, 'agent-browser', ['screenshot', '--json'])
  const parsed = JSON.parse(output) as { data?: { path?: string } }
  if (!parsed.data?.path) throw new Error('Sandbox browser did not return a screenshot path')
  return parsed.data.path
}

export async function captureOverlayRenderCertification(
  input: {
    overlayId: string
    websiteId: string
    url: string
    correctionAttempt?: 0 | 1
    browserEvidence?: unknown
  },
  client: SupabaseClient<Database> = createServiceClient()
): Promise<OverlayRenderCertification> {
  const correctionAttempt = input.correctionAttempt ?? 0
  if (correctionAttempt > 1) {
    throw new Error('SiteForge permits at most one overlay corrective render pass')
  }
  const snapshotId = process.env.SITEFORGE_BROWSER_SANDBOX_SNAPSHOT_ID
  if (!snapshotId) {
    throw new Error(
      'SITEFORGE_BROWSER_SANDBOX_SNAPSHOT_ID is required for visual certification'
    )
  }
  const target = new URL(input.url)
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new Error('Render certification requires an HTTP(S) URL')
  }

  const sandbox = await Sandbox.create({
    source: { type: 'snapshot', snapshotId },
    timeout: 120_000,
    networkPolicy: { allow: [target.hostname] },
    tags: { workload: 'siteforge-render' },
  })
  try {
    await run(sandbox, 'agent-browser', ['open', target.toString()])
    await run(sandbox, 'agent-browser', ['set', 'viewport', '1440', '1000'])
    const desktopPath = await screenshotPath(sandbox)
    const accessibility = await run(sandbox, 'agent-browser', [
      'snapshot',
      '-i',
      '-c',
    ])
    await run(sandbox, 'agent-browser', ['set', 'viewport', '390', '844'])
    const mobilePath = await screenshotPath(sandbox)
    const [desktop, mobile] = await Promise.all([
      sandbox.fs.readFile(desktopPath),
      sandbox.fs.readFile(mobilePath),
    ])
    await run(sandbox, 'agent-browser', ['close'])

    const capturedAt = new Date().toISOString()
    const browserReport = certifyBrowserEvidence({
      evidence: input.browserEvidence,
      expectedUrls: [target.toString()],
      criticalUrls: [target.toString()],
      evaluatedAt: capturedAt,
    })
    const certification: OverlayRenderCertification = {
      url: target.toString(),
      correctionAttempt,
      desktopSha256: digest(desktop),
      mobileSha256: digest(mobile),
      accessibilitySha256: digest(accessibility),
      evidenceStoragePath: `overlay-evidence/${input.websiteId}/${input.overlayId}/${correctionAttempt}.zip`,
      capturedAt,
      browserReport,
    }
    const evidenceZip = zipSync(
      {
        'desktop.png': desktop,
        'mobile.png': mobile,
        'accessibility.txt': strToU8(accessibility),
        'certification.json': strToU8(JSON.stringify(certification, null, 2)),
      },
      { level: 9 }
    )
    const { error: uploadError } = await client.storage
      .from(ARTIFACT_BUCKET)
      .upload(certification.evidenceStoragePath, evidenceZip, {
        contentType: 'application/zip',
        upsert: true,
      })
    if (uploadError) {
      throw new Error(`Failed to store render certification: ${uploadError.message}`)
    }
    const { error: updateError } = await client
      .from('siteforge_theme_overlays')
      .update({ screenshot_manifest: certification as unknown as Json })
      .eq('id', input.overlayId)
      .eq('website_id', input.websiteId)
    if (updateError) {
      throw new Error(`Failed to persist render certification: ${updateError.message}`)
    }
    return certification
  } finally {
    await sandbox.stop()
  }
}
