import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { jsPDF } from 'jspdf'

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

    const access = await validatePropertyAccess(user.id, brand.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Verify all 12 sections are approved
    const requiredSections = [
      'section_1_introduction',
      'section_2_positioning',
      'section_3_target_audience',
      'section_4_personas',
      'section_5_name_story',
      'section_6_logo',
      'section_7_typography',
      'section_8_colors',
      'section_9_design_elements',
      'section_10_photo_yep',
      'section_11_photo_nope',
      'section_12_implementation'
    ] as const

    const sectionValues = [
      brand.section_1_introduction,
      brand.section_2_positioning,
      brand.section_3_target_audience,
      brand.section_4_personas,
      brand.section_5_name_story,
      brand.section_6_logo,
      brand.section_7_typography,
      brand.section_8_colors,
      brand.section_9_design_elements,
      brand.section_10_photo_yep,
      brand.section_11_photo_nope,
      brand.section_12_implementation,
    ]
    const missingIndex = sectionValues.findIndex(section => !section)
    const missingSection = missingIndex >= 0 ? requiredSections[missingIndex] : null
    if (missingSection) {
      return NextResponse.json({ 
        error: 'Not all sections approved', 
        missingSection 
      }, { status: 400 })
    }

    const section5 = asRecord(brand.section_5_name_story)
    const section6 = asRecord(brand.section_6_logo)
    const section7 = asRecord(brand.section_7_typography)

    const brandBook = {
      metadata: {
        brandName: asString(section5?.name),
        generatedAt: new Date().toISOString(),
        generatedBy: user.id,
        propertyId: brand.property_id
      },
      sections: {
        cover: {
          brandName: asString(section5?.name),
          tagline: asString(section5?.tagline),
          logo: asString(section6?.primary_url)
        },
        introduction: brand.section_1_introduction,
        positioning: brand.section_2_positioning,
        targetAudience: brand.section_3_target_audience,
        personas: brand.section_4_personas,
        nameStory: brand.section_5_name_story,
        logo: brand.section_6_logo,
        typography: brand.section_7_typography,
        colors: brand.section_8_colors,
        designElements: brand.section_9_design_elements,
        photoGuidelines: {
          yep: brand.section_10_photo_yep,
          nope: brand.section_11_photo_nope
        },
        implementation: brand.section_12_implementation
      }
    }

    const pdfBytes = buildBrandBookPdf(brandBook)
    const fileName = `${brand.property_id}/brand-book-${Date.now()}.pdf`
    const { error: uploadError } = await supabaseAdmin.storage
      .from('brand-assets')
      .upload(fileName, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true
      })

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


