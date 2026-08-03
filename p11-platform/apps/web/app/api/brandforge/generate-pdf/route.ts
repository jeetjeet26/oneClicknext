import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { jsPDF } from 'jspdf'
import { normalizeBrandAssetRow } from '@/utils/brandforge/normalize'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function stringifySection(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function buildBrandBookPdf(brandBook: Record<string, unknown>): Uint8Array {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 48
  const maxLineWidth = pageWidth - margin * 2
  let y = margin

  const writeHeading = (text: string) => {
    if (y > pageHeight - margin) {
      doc.addPage()
      y = margin
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.text(text, margin, y)
    y += 20
  }

  const writeBody = (text: string) => {
    const content = text.trim().length > 0 ? text : '-'
    const lines = doc.splitTextToSize(content, maxLineWidth)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    for (const line of lines) {
      if (y > pageHeight - margin) {
        doc.addPage()
        y = margin
      }
      doc.text(line, margin, y)
      y += 14
    }
    y += 10
  }

  const metadata = asRecord(brandBook.metadata)
  const sections = asRecord(brandBook.sections)
  const cover = asRecord(sections?.cover)

  writeHeading('BrandForge Brand Book')
  writeBody(`Brand: ${asString(cover?.brandName) || asString(metadata?.brandName) || 'Unknown'}`)
  writeBody(`Tagline: ${asString(cover?.tagline) || 'N/A'}`)
  writeBody(`Generated: ${asString(metadata?.generatedAt) || 'N/A'}`)
  writeBody(`Property ID: ${asString(metadata?.propertyId) || 'N/A'}`)

  if (sections) {
    const orderedSections: Array<[string, unknown]> = [
      ['Introduction', sections.introduction],
      ['Positioning', sections.positioning],
      ['Target Audience', sections.targetAudience],
      ['Personas', sections.personas],
      ['Name Story', sections.nameStory],
      ['Logo', sections.logo],
      ['Typography', sections.typography],
      ['Colors', sections.colors],
      ['Design Elements', sections.designElements],
      ['Photo Guidelines', sections.photoGuidelines],
      ['Implementation', sections.implementation],
    ]
    for (const [title, sectionValue] of orderedSections) {
      writeHeading(title)
      writeBody(stringifySection(sectionValue))
    }
  }

  const arrayBuffer = doc.output('arraybuffer')
  return new Uint8Array(arrayBuffer)
}

async function ensureBrandAssetsBucket(supabaseAdmin: ReturnType<typeof createAdminClient>) {
  const { error } = await supabaseAdmin.storage.createBucket('brand-assets', {
    public: true,
    fileSizeLimit: '20MB',
  })

  // Bucket may already exist (ignore this case).
  const message = error?.message?.toLowerCase() || ''
  if (error && !message.includes('already exists')) {
    throw error
  }
}

/**
 * Generate final brand book PDF artifact.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { brandAssetId } = await req.json()

    if (!brandAssetId) {
      return NextResponse.json({ error: 'brandAssetId required' }, { status: 400 })
    }

    const supabaseAdmin = createAdminClient()

    const { data: brand } = await supabaseAdmin
      .from('property_brand_assets')
      .select('*')
      .eq('id', brandAssetId)
      .single()

    if (!brand) {
      return NextResponse.json({ error: 'Brand asset not found' }, { status: 404 })
    }

    if (!brand.property_id) {
      return NextResponse.json({ error: 'Brand asset missing property' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, brand.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (
      brand.approval_status !== 'approved'
      && brand.generation_status !== 'complete'
    ) {
      return NextResponse.json({
        error: 'Brand contract must be approved before export',
      }, { status: 409 })
    }

    const contract = normalizeBrandAssetRow(
      brand as unknown as Record<string, unknown>,
    )
    const primaryLogo = contract.logos.variants.find(logo => logo.role === 'primary')

    const brandBook = {
      metadata: {
        brandName: contract.identity.name,
        generatedAt: new Date().toISOString(),
        generatedBy: user.id,
        propertyId: brand.property_id
      },
      sections: {
        cover: {
          brandName: contract.identity.name,
          tagline: contract.identity.tagline,
          logo: primaryLogo?.url,
        },
        introduction: contract.introduction,
        positioning: contract.positioning,
        targetAudience: contract.audience,
        personas: contract.personas,
        nameStory: contract.identity,
        logo: contract.logos,
        typography: contract.typography,
        colors: contract.colors,
        designElements: contract.designElements,
        photoGuidelines: {
          yep: contract.photographyYes,
          nope: contract.photographyNo,
        },
        implementation: contract.implementation,
      }
    }

    const pdfBytes = buildBrandBookPdf(brandBook)
    const fileName = `${brand.property_id}/brand-book-${Date.now()}.pdf`
    let { error: uploadError } = await supabaseAdmin.storage
      .from('brand-assets')
      .upload(fileName, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true
      })

    if (uploadError && uploadError.message.toLowerCase().includes('bucket not found')) {
      await ensureBrandAssetsBucket(supabaseAdmin)
      ;({ error: uploadError } = await supabaseAdmin.storage
        .from('brand-assets')
        .upload(fileName, pdfBytes, {
          contentType: 'application/pdf',
          upsert: true
        }))
    }

    if (uploadError) throw uploadError

    const { data: urlData } = supabaseAdmin.storage
      .from('brand-assets')
      .getPublicUrl(fileName)

    // Update brand asset with PDF URL
    await supabaseAdmin
      .from('property_brand_assets')
      .update({
        brand_book_pdf_url: urlData.publicUrl,
        pdf_generated_at: new Date().toISOString(),
        generation_status: 'complete'
      })
      .eq('id', brandAssetId)

    return NextResponse.json({
      success: true,
      pdfUrl: urlData.publicUrl,
      exportFormat: 'pdf',
      embeddedToKnowledgeBase: false,
      brandBookData: brandBook
    })

  } catch (error) {
    console.error('PDF Generation Error:', error)
    return NextResponse.json({ 
      error: 'PDF generation failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}


