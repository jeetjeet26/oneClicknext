import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Dialog, DialogContent } from '@/components/ui/dialog'

describe('SiteForge editor dialogs', () => {
  it('does not use browser-native confirmation or alert dialogs', async () => {
    const sources = await Promise.all(
      [
        'components/siteforge/WebsitePreview.tsx',
        'components/siteforge/SiteForgeOperationsPanel.tsx',
        'components/siteforge/ConversationalGenerationWizard.tsx',
      ].map(file => readFile(path.join(process.cwd(), file), 'utf8'))
    )

    for (const source of sources) {
      expect(source).not.toMatch(
        /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/
      )
    }
  })

  it('renders destructive confirmations with alert-dialog semantics', () => {
    const html = renderToStaticMarkup(
      createElement(
        Dialog,
        { open: true },
        createElement(
          DialogContent,
          { role: 'alertdialog' },
          'Confirm action'
        )
      )
    )

    expect(html).toContain('role="alertdialog"')
    expect(html).toContain('aria-modal="true"')
  })
})
