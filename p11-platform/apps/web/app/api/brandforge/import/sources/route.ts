import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { extractText } from 'unpdf'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { brandReply, brandRpc } from '@/utils/brandforge/operations'

export async function POST(request: NextRequest) {
  let saving = false
  try {
    const auth = await createClient()
    const { data: { user }, error } = await auth.auth.getUser()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const form = await request.formData()
    const propertyId = z.guid().parse(form.get('propertyId'))
    const requestId = z.string().uuid().parse(form.get('requestId'))
    if (!(await validatePropertyAccess(user.id, propertyId)).authorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const file = form.get('file')
    if (!(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024) throw new Error('Choose a brand package file up to 10MB.')
    const mime = file.name.toLowerCase().endsWith('.md') ? 'text/markdown' : file.type
    if (!['application/pdf', 'text/plain', 'text/markdown'].includes(mime)) throw new Error('Choose a PDF, text or Markdown file.')
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (mime === 'application/pdf' && new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('Invalid PDF file.')
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    const name = file.name.slice(0, 255)
    const inputHash = createHash('sha256').update(JSON.stringify({ contentHash, name, mime })).digest('hex')
    const extracted = mime === 'application/pdf' ? (await extractText(bytes)).text : new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const content = (Array.isArray(extracted) ? extracted.join('\n\n') : extracted).trim()
    if (!content || content.length > 2_000_000) throw new Error('The package must contain readable text of at most 2 million characters.')
    saving = true
    return brandReply(await brandRpc('save_brand_import_source', { p_property_id: propertyId, p_actor_id: user.id, p_request_id: requestId, p_input_hash: inputHash, p_content_hash: contentHash, p_name: name, p_mime_type: mime, p_content: content }))
  } catch (error) {
    return NextResponse.json({ error: saving ? 'The saved source could not be confirmed. Retry the same file.' : error instanceof z.ZodError ? 'A valid property and request are required.' : error instanceof Error ? error.message : 'Brand source could not be read.' }, { status: saving ? 503 : 400 })
  }
}
