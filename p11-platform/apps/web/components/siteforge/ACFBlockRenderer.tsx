'use client'

// SiteForge: ACF Block Visual Renderer
// Renders ACF block content as styled HTML preview
// Created: December 11, 2025

import React from 'react'
import type { ACFBlockType } from '@/types/siteforge'
import { sanitizeSiteForgePreviewHtml } from '@/utils/siteforge/preview-html-sanitizer'

export interface DesignSystem {
  colorSystem?: {
    primary?: string
    secondary?: string
    accent?: string
    background?: string
    text?: string
  }
  colors?: {
    primary?: string
    secondary?: string
    accent?: string
    background?: string
    text?: string
  }
  typography?: {
    headingFont?: string
    bodyFont?: string
  }
  spacing?: {
    containerMaxWidth?: string
    sectionPadding?: string
  }
}

interface BlockRendererProps {
  blockType: string
  blockIdentity: string
  content: unknown
  className?: string
  variant?: string
  designSystem?: DesignSystem
}

type BlockContent = Record<string, unknown>
type BlockComponentProps = {
  blockIdentity: string
  content: BlockContent
  designSystem?: DesignSystem
}

function asRecord(value: unknown): BlockContent {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as BlockContent)
    : {}
}

function getString(content: BlockContent, key: string, fallback = ''): string {
  return typeof content[key] === 'string' ? content[key] : fallback
}

function getSanitizedHtml(content: BlockContent, key: string): string {
  return sanitizeSiteForgePreviewHtml(getString(content, key))
}

function domIdPrefix(blockIdentity: string): string {
  const normalized =
    blockIdentity
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'block'
  let hash = 2_166_136_261
  for (let index = 0; index < blockIdentity.length; index += 1) {
    hash ^= blockIdentity.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return `siteforge-${normalized}-${(hash >>> 0).toString(36)}`
}

function getNumber(content: BlockContent, key: string, fallback = 0): number {
  return typeof content[key] === 'number' ? content[key] : fallback
}

function getRecordArray(content: BlockContent, key: string): BlockContent[] {
  return Array.isArray(content[key]) ? content[key].map(asRecord) : []
}

function getStringArray(content: BlockContent, key: string): string[] {
  return Array.isArray(content[key])
    ? content[key].filter((value): value is string => typeof value === 'string')
    : []
}

function getNumberArray(content: BlockContent, key: string): number[] {
  return Array.isArray(content[key])
    ? content[key].filter((value): value is number => typeof value === 'number')
    : []
}

function getImage(
  content: BlockContent,
  key = 'image'
): { url: string; alt: string } | null {
  const image = asRecord(content[key])
  const url = getString(image, 'url')
  if (!url) return null
  return {
    url,
    alt: getString(image, 'alt'),
  }
}

function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

function externalLinkProps(href: string) {
  return isExternalHref(href)
    ? { target: '_blank' as const, rel: 'noopener noreferrer' }
    : {}
}

function DegradedBlock({
  title,
  detail,
}: {
  title: string
  detail: string
}) {
  return (
    <div
      className="rounded-lg border border-amber-200 bg-amber-50 p-6 dark:border-amber-800 dark:bg-amber-900/20"
      data-preview-state="degraded"
      role="status"
    >
      <p className="font-semibold text-amber-900 dark:text-amber-100">{title}</p>
      <p className="mt-2 text-sm text-amber-800 dark:text-amber-200">{detail}</p>
    </div>
  )
}

type CriticalPreviewState = {
  degraded: boolean
  reason?: string
}

/**
 * Map semantic section types to ACF block types
 * Used as fallback when Architecture Agent doesn't specify block
 */
const semanticTypeToBlock: Record<string, string> = {
  'hero': 'acf/top-slides',
  'conversion': 'acf/form',
  'messaging': 'acf/text-section',
  'value_proposition': 'acf/text-section',
  'amenities': 'acf/content-grid',
  'amenity': 'acf/feature-section',
  'gallery': 'acf/gallery',
  'floorplans': 'acf/plans-availability',
  'floor_plans': 'acf/plans-availability',
  'contact': 'acf/form',
  'cta': 'acf/links',
  'neighborhood': 'acf/poi',
  'location': 'acf/map',
  'map': 'acf/map',
  'faq': 'acf/accordion-section',
  'features': 'acf/feature-section',
  'lifestyle': 'acf/feature-section',
  'intro': 'acf/text-section',
  'about': 'acf/text-section',
  'text': 'acf/text-section',
  'reviews': 'acf/testimonials',
  'testimonials': 'acf/testimonials',
}

export function getCriticalPreviewState(
  blockType: string,
  content: Record<string, unknown> | null | undefined
): CriticalPreviewState {
  const normalized = blockType.toLowerCase()

  if (normalized === 'acf/top-slides') {
    const slides = Array.isArray(content?.slides) ? content.slides : []
    if (slides.length === 0) {
      return { degraded: true, reason: 'missing_hero_slides' }
    }
  }

  if (normalized === 'acf/map') {
    const hasAddress = typeof content?.address === 'string' && content.address.trim().length > 0
    const hasCoordinates =
      typeof content?.latitude === 'number' && typeof content?.longitude === 'number'
    if (!hasAddress && !hasCoordinates) {
      return { degraded: true, reason: 'missing_map_location' }
    }
  }

  if (
    normalized === 'acf/form' &&
    content?.provider !== 'p11_lumaleasing'
  ) {
    return { degraded: true, reason: 'unsupported_form_provider' }
  }

  if (normalized === 'acf/plans-availability') {
    const floorPlans = Array.isArray(content?.floor_plans) ? content.floor_plans : []
    if (floorPlans.length === 0) {
      return { degraded: true, reason: 'missing_floor_plan_inventory' }
    }
  }

  return { degraded: false }
}

/**
 * Generate CSS custom properties from design system
 */
function getDesignSystemStyles(designSystem?: DesignSystem): React.CSSProperties {
  if (!designSystem) return {}
  
  const colors = designSystem.colorSystem || designSystem.colors || {}
  const typography = designSystem.typography || {}
  
  return {
    '--brand-primary': colors.primary || '#4F46E5',
    '--brand-secondary': colors.secondary || '#10B981',
    '--brand-accent': colors.accent || '#F59E0B',
    '--brand-background': colors.background || '#FFFFFF',
    '--brand-text': colors.text || '#1F2937',
    '--font-heading': typography.headingFont ? `'${typography.headingFont}', serif` : "'Playfair Display', serif",
    '--font-body': typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : "'Inter', sans-serif",
    '--container-max-width': designSystem.spacing?.containerMaxWidth || '1400px',
    '--section-padding': designSystem.spacing?.sectionPadding || '6rem',
  } as React.CSSProperties
}

/**
 * Main renderer that delegates to specific block renderers
 */
export function ACFBlockRenderer({
  blockType,
  blockIdentity,
  content,
  className = '',
  variant,
  designSystem,
}: BlockRendererProps) {
  const blockContent = asRecord(content)
  if (Object.keys(blockContent).length === 0) {
    return (
      <div className={className} data-acf-block={blockType}>
        <DegradedBlock
          title="Content not generated for this section"
          detail={`The P11 approximation cannot render ${blockType} without source content.`}
        />
      </div>
    )
  }

  // Try direct match first, then fall back to semantic type mapping
  let resolvedBlockType = blockType
  if (!(blockType in REGISTERED_BLOCK_RENDERERS)) {
    // Try semantic type mapping
    const mappedType = semanticTypeToBlock[blockType?.toLowerCase()]
    if (mappedType) {
      resolvedBlockType = mappedType
    }
  }
  
  const Renderer =
    REGISTERED_BLOCK_RENDERERS[
      resolvedBlockType as keyof typeof REGISTERED_BLOCK_RENDERERS
    ]
  
  if (!Renderer) {
    return (
      <div className={className} data-acf-block={blockType}>
        <DegradedBlock
          title={`Unsupported block type: ${blockType}`}
          detail="This block is preserved in the artifact but has no P11 approximation. Review it in the exact WordPress preview."
        />
      </div>
    )
  }

  // Apply design system styles as CSS custom properties
  const brandStyles = getDesignSystemStyles(designSystem)
  const normalizedVariant = variant?.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
  const blockClass = `block-${resolvedBlockType.replace(/^acf\//, '')}`
  const wrapperClassName = [
    className,
    blockClass,
    normalizedVariant ? `variant-${normalizedVariant}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={wrapperClassName}
      style={brandStyles}
      data-acf-block={resolvedBlockType}
      data-siteforge-variant={normalizedVariant || undefined}
    >
      <Renderer
        blockIdentity={blockIdentity}
        content={blockContent}
        designSystem={designSystem}
      />
    </div>
  )
}

/**
 * Hero Slides - Top carousel with CTAs
 */
function HeroSlides({ content, designSystem }: BlockComponentProps) {
  const slides = getRecordArray(content, 'slides')
  const colors = designSystem?.colors || {}
  const typography = designSystem?.typography || {}
  
  // Do not fake complete hero output when content is missing.
  if (slides.length === 0) {
    return (
      <DegradedBlock
        title="Hero block is missing structured slide content"
        detail="P11 intentionally avoids placeholder headlines and calls to action. Add reviewed slides or inspect the exact WordPress preview."
      />
    )
  }
  
  return (
    <div 
      className="relative rounded-lg overflow-hidden"
      style={{ 
        background: colors.primary 
          ? `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary || colors.primary} 100%)`
          : 'linear-gradient(135deg, #1F2937 0%, #111827 100%)'
      }}
    >
      {slides.map((slide, idx) => {
        const image = getImage(slide)
        return (
        <div key={idx} className="relative min-h-[420px] overflow-hidden p-8 text-white md:p-12">
          {image && (
            // SiteForge previews render approved remote asset URLs.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image.url}
              alt={image.alt}
              className="absolute inset-0 h-full w-full object-cover"
              loading={idx === 0 ? 'eager' : 'lazy'}
              decoding="async"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/45 to-black/15" />
          <div className="relative z-10 max-w-2xl">
            <h2 
              className="text-3xl md:text-4xl font-bold mb-3"
              style={{ fontFamily: typography.headingFont ? `'${typography.headingFont}', serif` : undefined }}
            >
              {getString(slide, 'headline')}
            </h2>
            <p 
              className="text-lg text-gray-200 mb-6"
              style={{ fontFamily: typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : undefined }}
            >
              {getString(slide, 'subheadline')}
            </p>
            {getString(slide, 'cta_text') && getString(slide, 'cta_link') ? (
              <a
                href={getString(slide, 'cta_link')}
                {...externalLinkProps(getString(slide, 'cta_link'))}
                className="inline-block rounded-lg px-6 py-3 font-semibold text-white transition hover:opacity-90"
                style={{
                  backgroundColor: colors.accent || colors.primary || '#4F46E5',
                  fontFamily: typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : undefined
                }}
              >
                {getString(slide, 'cta_text')}
              </a>
            ) : null}
          </div>
        </div>
        )
      })}
    </div>
  )
}

/**
 * Text Section - Headline + content block
 */
function TextSection({ content, designSystem }: BlockComponentProps) {
  const typography = designSystem?.typography || {}
  
  const bgClasses: Record<string, string> = {
    white: 'bg-white dark:bg-gray-900',
    light: 'bg-gray-50 dark:bg-gray-800',
    dark: 'bg-gray-900 dark:bg-black text-white'
  }
  const bgClass = bgClasses[String(content.background)] || 'bg-white dark:bg-gray-900'
  
  const alignClasses: Record<string, string> = {
    center: 'text-center mx-auto',
    left: 'text-left',
    right: 'text-right ml-auto'
  }
  const alignClass = alignClasses[String(content.layout)] || 'text-center mx-auto'

  return (
    <div className={`p-6 md:p-8 rounded-lg ${bgClass}`}>
      <div className={`max-w-3xl ${alignClass}`}>
        <h3 
          className="text-2xl font-bold mb-4 text-gray-900 dark:text-white"
          style={{ fontFamily: typography.headingFont ? `'${typography.headingFont}', serif` : undefined }}
        >
          {getString(content, 'headline')}
        </h3>
        <div 
          className="prose dark:prose-invert max-w-none text-gray-600 dark:text-gray-300"
          style={{ fontFamily: typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : undefined }}
          dangerouslySetInnerHTML={{ __html: getSanitizedHtml(content, 'content') }}
        />
      </div>
    </div>
  )
}

/**
 * Content Grid - Grid of items with icons
 */
function ContentGrid({ content, designSystem }: BlockComponentProps) {
  const items = getRecordArray(content, 'items')
  const cols = content.columns || 3
  const colors = designSystem?.colors || {}
  const typography = designSystem?.typography || {}
  
  const colsClasses: Record<string, string> = {
    '2': 'md:grid-cols-2',
    '3': 'md:grid-cols-3',
    '4': 'md:grid-cols-4'
  }
  const colsClass = colsClasses[String(cols)] || 'md:grid-cols-3'

  // Generate lighter tint of primary color for icon background
  const iconBgColor = colors.primary ? `${colors.primary}20` : undefined

  return (
    <div className={`grid grid-cols-1 ${colsClass} gap-6 p-4`}>
      {items.map((item, idx) => (
        <div key={idx} className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-100 dark:border-gray-700">
          {getString(item, 'icon') && (
            <div 
              className="w-12 h-12 rounded-lg flex items-center justify-center mb-4"
              style={{ 
                backgroundColor: iconBgColor || 'rgb(238 242 255)',
                color: colors.primary || '#4F46E5'
              }}
            >
              <span className="text-xl">
                {getIconEmoji(getString(item, 'icon'))}
              </span>
            </div>
          )}
          <h4 
            className="font-semibold text-gray-900 dark:text-white mb-2"
            style={{ fontFamily: typography.headingFont ? `'${typography.headingFont}', serif` : undefined }}
          >
            {getString(item, 'headline')}
          </h4>
          <p 
            className="text-sm text-gray-600 dark:text-gray-400"
            style={{ fontFamily: typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : undefined }}
          >
            {getString(item, 'description')}
          </p>
        </div>
      ))}
    </div>
  )
}

/**
 * Feature Section - Image + text side by side
 */
function FeatureSection({ content, designSystem }: BlockComponentProps) {
  const isImageLeft = content.layout === 'image-left'
  const colors = designSystem?.colors || {}
  const typography = designSystem?.typography || {}
  const image = getImage(content)
  
  return (
    <div className={`flex flex-col ${isImageLeft ? 'md:flex-row' : 'md:flex-row-reverse'} gap-8 p-4 items-center`}>
      <div className="w-full md:w-1/2">
        {image ? (
          // SiteForge previews render approved remote asset URLs.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.url}
            alt={image.alt}
            className="aspect-video w-full rounded-lg object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-lg bg-gray-200 dark:bg-gray-700">
            <span className="text-gray-500 dark:text-gray-400">Image unavailable</span>
          </div>
        )}
      </div>
      <div className="w-full md:w-1/2">
        <h3 
          className="text-2xl font-bold mb-4 text-gray-900 dark:text-white"
          style={{ fontFamily: typography.headingFont ? `'${typography.headingFont}', serif` : undefined }}
        >
          {getString(content, 'headline')}
        </h3>
        <div 
          className="prose dark:prose-invert max-w-none text-gray-600 dark:text-gray-300 mb-6"
          style={{ fontFamily: typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : undefined }}
          dangerouslySetInnerHTML={{ __html: getSanitizedHtml(content, 'content') }}
        />
        {getString(content, 'cta_text') && getString(content, 'cta_link') && (
          <a 
            href={getString(content, 'cta_link')}
            {...externalLinkProps(getString(content, 'cta_link'))}
            className="inline-block text-white font-medium px-5 py-2 rounded-lg transition hover:opacity-90"
            style={{ backgroundColor: colors.primary || '#4F46E5' }}
          >
            {getString(content, 'cta_text')}
          </a>
        )}
      </div>
    </div>
  )
}

/**
 * Gallery - Image grid
 */
function Gallery({ content }: BlockComponentProps) {
  const indices = getNumberArray(content, 'image_indices')
  const images = getRecordArray(content, 'images')
    .map((image) => {
      const url = getString(image, 'url')
      return url
        ? { url, alt: getString(image, 'alt', 'Property gallery image') }
        : null
    })
    .filter((image): image is { url: string; alt: string } => image !== null)
  const layout = content.layout || 'grid'
  
  return (
    <div className="p-4">
      <div className={`grid ${layout === 'grid' ? 'grid-cols-2 md:grid-cols-3' : 'grid-cols-1'} gap-4`}>
        {images.length > 0
          ? images.map((image) => (
              // SiteForge previews render approved remote asset URLs.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={image.url}
                src={image.url}
                alt={image.alt}
                className="aspect-square w-full rounded-lg object-cover"
                loading="lazy"
                decoding="async"
              />
            ))
          : indices.map((idx: number) => (
              <div key={idx} className="flex aspect-square items-center justify-center rounded-lg bg-gray-200 dark:bg-gray-700">
                <span className="text-gray-500 dark:text-gray-400">Image unavailable</span>
              </div>
            ))}
      </div>
    </div>
  )
}

/**
 * Form Section - Contact/inquiry form
 */
function FormSection({ blockIdentity, content, designSystem }: BlockComponentProps) {
  const colors = designSystem?.colors || {}
  const typography = designSystem?.typography || {}
  const idPrefix = domIdPrefix(blockIdentity)
  const fieldIds = {
    email: `${idPrefix}-email`,
    message: `${idPrefix}-message`,
    name: `${idPrefix}-name`,
    phone: `${idPrefix}-phone`,
  }

  if (content.provider !== 'p11_lumaleasing') {
    return (
      <DegradedBlock
        title="Form provider is not publishable"
        detail="This artifact does not target the supported P11 LumaLeasing conversion provider. Update the confirmed conversion contract before launch."
      />
    )
  }
  
  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-8 max-w-xl mx-auto">
      <h3 
        className="text-2xl font-bold mb-2 text-gray-900 dark:text-white text-center"
        style={{ fontFamily: typography.headingFont ? `'${typography.headingFont}', serif` : undefined }}
      >
        {getString(content, 'heading')}
      </h3>
      <p 
        className="text-gray-600 dark:text-gray-400 mb-6 text-center"
        style={{ fontFamily: typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : undefined }}
      >
        {getString(content, 'subheading')}
      </p>
      <div className="space-y-4">
        <label className="sr-only" htmlFor={fieldIds.name}>Name</label>
        <input 
          id={fieldIds.name}
          type="text" 
          placeholder="Your Name" 
          className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700"
          disabled
        />
        <label className="sr-only" htmlFor={fieldIds.email}>Email</label>
        <input 
          id={fieldIds.email}
          type="email" 
          placeholder="Email Address" 
          className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700"
          disabled
        />
        <label className="sr-only" htmlFor={fieldIds.phone}>Phone</label>
        <input 
          id={fieldIds.phone}
          type="tel" 
          placeholder="Phone Number" 
          className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700"
          disabled
        />
        <label className="sr-only" htmlFor={fieldIds.message}>Message</label>
        <textarea 
          id={fieldIds.message}
          placeholder="Message" 
          rows={3}
          className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700"
          disabled
        />
        <button 
          type="button"
          disabled
          className="w-full text-white font-semibold py-3 rounded-lg transition hover:opacity-90"
          style={{ backgroundColor: colors.primary || '#4F46E5' }}
        >
          Submit
        </button>
      </div>
    </div>
  )
}

/**
 * Map Section - explicit degraded state, no fake live map rendering
 */
function MapSection({ content }: BlockComponentProps) {
  const address = typeof content.address === 'string' ? content.address.trim() : ''
  const latitude = typeof content.latitude === 'number' ? content.latitude : null
  const longitude = typeof content.longitude === 'number' ? content.longitude : null
  const hasCoordinates =
    latitude !== null && longitude !== null
  const hasLocation = address.trim().length > 0 || hasCoordinates
  const destination = address || (hasCoordinates ? `${latitude},${longitude}` : '')

  if (!hasLocation) {
    return (
      <DegradedBlock
        title="Map location not configured"
        detail="P11 does not fabricate map tiles or a location. Review the exact WordPress preview after a sourced address or coordinates are available."
      />
    )
  }

  return (
    <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
      <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Location block</h4>
      <div className="mt-2 text-sm text-gray-700 dark:text-gray-300 space-y-1">
        {address && <p>Address: {address}</p>}
        {hasCoordinates && (
          <p>
            Coordinates: {latitude}, {longitude}
          </p>
        )}
        <p>Zoom: {typeof content.zoom_level === 'number' ? content.zoom_level : 15}</p>
        {content.show_directions === true && destination && (
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm font-medium text-blue-700 underline dark:text-blue-300"
          >
            Get directions
          </a>
        )}
        <div className="pt-1 text-xs text-gray-500 dark:text-gray-400">
          Live map tiles are intentionally omitted; this keyless location fallback uses only sourced data.
        </div>
      </div>
    </div>
  )
}

/**
 * Links Section - CTA buttons
 */
function LinksSection({ content, designSystem }: BlockComponentProps) {
  const links = getRecordArray(content, 'links')
  const colors = designSystem?.colors || {}
  
  return (
    <div className="flex flex-wrap gap-4 justify-center p-4">
      {links.map((link, idx) => (
        <a
          key={idx}
          href={getString(link, 'url')}
          {...externalLinkProps(getString(link, 'url'))}
          className={`px-6 py-3 rounded-lg font-medium transition hover:opacity-90 ${
            getString(link, 'style') !== 'primary'
              ? 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white'
              : 'text-white'
          }`}
          style={getString(link, 'style') === 'primary' ? { backgroundColor: colors.primary || '#4F46E5' } : undefined}
        >
          {getString(link, 'text')}
        </a>
      ))}
    </div>
  )
}

/**
 * Accordion Section - FAQ style
 */
function AccordionSection({ content, designSystem }: BlockComponentProps) {
  const items = getRecordArray(content, 'items')
  const typography = designSystem?.typography || {}
  
  return (
    <div className="space-y-3 p-4">
      {items.map((item, idx) => (
        <details key={idx} className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
          <summary
            className="cursor-pointer bg-gray-50 px-4 py-3 font-medium text-gray-900 dark:bg-gray-800 dark:text-white"
            style={{ fontFamily: typography.headingFont ? `'${typography.headingFont}', serif` : undefined }}
          >
            {getString(item, 'title')}
          </summary>
          <div 
            className="px-4 py-3 text-gray-600 dark:text-gray-300 prose dark:prose-invert max-w-none"
            style={{ fontFamily: typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : undefined }}
            dangerouslySetInnerHTML={{ __html: getSanitizedHtml(item, 'content') }}
          />
        </details>
      ))}
    </div>
  )
}

/**
 * Image Section - Single image
 */
function ImageSection({ content, designSystem }: BlockComponentProps) {
  const typography = designSystem?.typography || {}
  const image = getImage(content)
  const sizeClasses: Record<string, string> = {
    full: 'w-full',
    large: 'max-w-4xl mx-auto',
    medium: 'max-w-2xl mx-auto'
  }
  const sizeClass = sizeClasses[String(content.size)] || 'max-w-4xl mx-auto'

  return (
    <div className={`p-4 ${sizeClass}`}>
      {image ? (
        // SiteForge previews render approved remote asset URLs.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image.url}
          alt={image.alt}
          className="aspect-video w-full rounded-lg object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="flex aspect-video items-center justify-center rounded-lg bg-gray-200 dark:bg-gray-700">
          <span className="text-gray-500 dark:text-gray-400">Image unavailable</span>
        </div>
      )}
      {getString(content, 'caption') && (
        <p 
          className="text-center text-sm text-gray-500 dark:text-gray-400 mt-2 italic"
          style={{ fontFamily: typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : undefined }}
        >
          {getString(content, 'caption')}
        </p>
      )}
    </div>
  )
}

/**
 * HTML Section - Custom HTML
 */
function HtmlSection({ content }: BlockComponentProps) {
  return (
    <DegradedBlock
      title="Custom HTML is not rendered in P11"
      detail={
        getString(content, 'html_content')
          ? 'The custom HTML remains in the artifact. Open the exact WordPress preview to inspect its theme-rendered output safely.'
          : 'No custom HTML content is available for this block.'
      }
    />
  )
}

/**
 * Menu Section - Navigation links
 */
function MenuSection({ content, designSystem }: BlockComponentProps) {
  const items = Array.isArray(content.menu_items) ? content.menu_items : []
  const typography = designSystem?.typography || {}
  
  return (
    <div className="flex flex-wrap gap-2 justify-center p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
      {items.map((item: unknown, idx: number) => {
        const menuItem =
          item && typeof item === 'object' && !Array.isArray(item)
            ? (item as Record<string, unknown>)
            : null
        const label =
          typeof item === 'string'
            ? item
            : typeof menuItem?.label === 'string'
              ? menuItem.label
              : 'Explore'
        const link =
          typeof menuItem?.link === 'string' ? menuItem.link : undefined

        return (
        <a
          key={`${label}-${idx}`}
          href={link}
          {...(link ? externalLinkProps(link) : {})}
          className="px-4 py-2 bg-white dark:bg-gray-700 rounded-full text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 cursor-pointer transition"
          style={{ fontFamily: typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : undefined }}
        >
          {label}
        </a>
        )
      })}
    </div>
  )
}

const FLOOR_PLAN_PLACEHOLDER_SLOTS = [
  'Floor plan placeholder 1',
  'Floor plan placeholder 2',
  'Floor plan placeholder 3',
]

/**
 * Plans Availability - explicit placeholders without invented inventory facts
 */
function PlansAvailability({ content, designSystem }: BlockComponentProps) {
  const colors = designSystem?.colors || {}
  const typography = designSystem?.typography || {}
  const floorPlans = getRecordArray(content, 'floor_plans')
  const showPricing = content.show_pricing !== false
  const showAvailability = content.show_availability !== false
  
  // Generate gradient from brand colors
  const gradientFrom = colors.primary ? `${colors.primary}10` : 'rgb(238 242 255)'
  const gradientTo = colors.secondary ? `${colors.secondary}10` : 'rgb(250 245 255)'

  if (floorPlans.length === 0) {
    return (
      <div
        className="rounded-lg p-8"
        style={{ background: `linear-gradient(135deg, ${gradientFrom} 0%, ${gradientTo} 100%)` }}
      >
        <h4
          className="text-lg font-semibold text-gray-900 dark:text-white mb-2"
          style={{ fontFamily: typography.headingFont ? `'${typography.headingFont}', serif` : undefined }}
        >
          Floor plans coming soon
        </h4>
        <p
          className="text-sm text-gray-700 dark:text-gray-300 mb-5"
          style={{ fontFamily: typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : undefined }}
        >
          These placeholders reserve the final layout without inventing pricing, availability, or
          unit details. Add reviewed floor plans whenever they are ready.
        </p>
        <div className="grid gap-3 sm:grid-cols-3" aria-label="Future floor plan placeholders">
          {FLOOR_PLAN_PLACEHOLDER_SLOTS.map((label) => (
            <div
              key={label}
              className="rounded-lg border border-dashed border-gray-300 bg-white/60 p-4 dark:border-gray-600 dark:bg-gray-900/40"
            >
              <div className="mb-3 aspect-[4/3] rounded-md bg-gray-200/80 dark:bg-gray-700/80" />
              <div className="mb-2 h-3 w-2/3 rounded bg-gray-300 dark:bg-gray-600" />
              <div className="h-3 w-1/2 rounded bg-gray-200 dark:bg-gray-700" />
              <span className="sr-only">{label}; details to be added</span>
            </div>
          ))}
        </div>
      </div>
    )
  }
  
  return (
    <div
      className="rounded-lg p-8"
      style={{ background: `linear-gradient(135deg, ${gradientFrom} 0%, ${gradientTo} 100%)` }}
    >
      <h4
        className="mb-2 text-center text-lg font-semibold text-gray-900 dark:text-white"
        style={{ fontFamily: typography.headingFont ? `'${typography.headingFont}', serif` : undefined }}
      >
        Floor Plans Available
      </h4>
      <p
        className="mb-6 text-center text-sm text-gray-600 dark:text-gray-400"
        style={{ fontFamily: typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : undefined }}
      >
        {floorPlans.length} reviewed plan{floorPlans.length === 1 ? '' : 's'}
      </p>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {floorPlans.map((plan, index) => {
          const name = getString(plan, 'name', `Floor plan ${index + 1}`)
          const imageUrl = getString(plan, 'image_url')
          const bedrooms = getNumber(plan, 'bedrooms')
          const bathrooms = getNumber(plan, 'bathrooms', -1)
          const sqftMin = getNumber(plan, 'sqft_min', -1)
          const sqftMax = getNumber(plan, 'sqft_max', -1)
          const rentMin = getNumber(plan, 'rent_min', -1)
          const rentMax = getNumber(plan, 'rent_max', -1)
          const availableCount = getNumber(plan, 'available_count', -1)
          const sqft =
            sqftMin >= 0
              ? sqftMax >= 0 && sqftMax !== sqftMin
                ? `${sqftMin.toLocaleString()}–${sqftMax.toLocaleString()} sq ft`
                : `${sqftMin.toLocaleString()} sq ft`
              : null
          const rent =
            rentMin >= 0
              ? rentMax >= 0 && rentMax !== rentMin
                ? `$${rentMin.toLocaleString()}–$${rentMax.toLocaleString()}`
                : `From $${rentMin.toLocaleString()}`
              : null

          return (
            <article
              key={getString(plan, 'id', `${name}-${index}`)}
              className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900"
            >
              {imageUrl && (
                // The preview supports user-managed Supabase and provider URLs.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl}
                  alt={getString(plan, 'image_alt', `${name} floor plan`)}
                  className="aspect-[4/3] w-full bg-white object-contain p-3"
                  loading="lazy"
                  decoding="async"
                />
              )}
              <div className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <h5 className="font-semibold text-gray-900 dark:text-white">{name}</h5>
                  {showPricing && rent && (
                    <span className="shrink-0 text-sm font-semibold text-gray-900 dark:text-white">
                      {rent}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  {bedrooms === 0 ? 'Studio' : `${bedrooms} bedroom${bedrooms === 1 ? '' : 's'}`}
                  {bathrooms >= 0 ? ` · ${bathrooms} bath${bathrooms === 1 ? '' : 's'}` : ''}
                  {sqft ? ` · ${sqft}` : ''}
                </p>
                {showAvailability && availableCount >= 0 && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {availableCount} available
                  </p>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Points of Interest - Neighborhood map
 */
function PointsOfInterest({ content, designSystem }: BlockComponentProps) {
  const categories = getStringArray(content, 'categories')
  const points = getRecordArray(content, 'points')
  const colors = designSystem?.colors || {}
  const typography = designSystem?.typography || {}
  
  // Generate category badge colors from brand
  const badgeBg = colors.primary ? `${colors.primary}20` : 'rgb(238 242 255)'
  const badgeText = colors.primary || '#4338CA'
  
  return (
    <div className="p-4">
      <p 
        className="text-lg font-medium text-gray-900 dark:text-white mb-4"
        style={{ fontFamily: typography.headingFont ? `'${typography.headingFont}', serif` : undefined }}
      >
        {getString(content, 'intro_text')}
      </p>
      {points.length > 0 ? (
        <ul className="mb-4 grid gap-3 sm:grid-cols-2">
          {points.map((point, index) => (
            <li
              key={`${getString(point, 'name')}-${index}`}
              className="rounded-lg border border-gray-200 p-4 dark:border-gray-700"
            >
              <p className="font-medium">{getString(point, 'name')}</p>
              {getString(point, 'category') ? (
                <p className="text-sm capitalize text-gray-600 dark:text-gray-400">
                  {getString(point, 'category')}
                </p>
              ) : null}
              {getString(point, 'address') ? (
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  {getString(point, 'address')}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <DegradedBlock
          title="Points of interest are not available"
          detail="P11 does not draw a placeholder map. Add sourced places or inspect the exact WordPress preview."
        />
      )}
      <div className="flex flex-wrap gap-2 justify-center">
        {categories.map((cat, idx) => (
          <span 
            key={idx}
            className="px-3 py-1 rounded-full text-sm capitalize"
            style={{ backgroundColor: badgeBg, color: badgeText }}
          >
            {cat}
          </span>
        ))}
      </div>
    </div>
  )
}

function Testimonials({ content }: BlockComponentProps) {
  const heading = getString(content, 'heading', 'Resident experiences')
  const reviews = getRecordArray(content, 'reviews')
  if (reviews.length === 0) {
    return (
      <DegradedBlock
        title="No approved ReviewFlow testimonials are available"
        detail="The artifact preserves this section, but P11 will not synthesize resident reviews."
      />
    )
  }
  return (
    <section
      className="px-6 py-16"
      style={{ background: 'var(--brand-background)' }}
    >
      <div className="mx-auto max-w-6xl">
        <h2
          className="mb-10 text-3xl font-bold md:text-5xl"
          style={{
            color: 'var(--brand-text)',
            fontFamily: 'var(--font-heading)',
          }}
        >
          {heading}
        </h2>
        <div className="grid gap-6 md:grid-cols-3">
          {reviews.map(review => {
            const rating = Math.max(
              1,
              Math.min(5, getNumber(review, 'rating', 5))
            )
            return (
              <figure
                key={getString(review, 'id')}
                className="m-0 border p-6 shadow-sm"
              >
                <div
                  className="mb-4 tracking-widest"
                  aria-label={`${rating} out of 5 stars`}
                  style={{ color: 'var(--brand-accent)' }}
                >
                  {'★'.repeat(rating)}
                </div>
                <blockquote className="m-0 text-lg leading-relaxed">
                  “{getString(review, 'review_text')}”
                </blockquote>
                <figcaption className="mt-6 flex justify-between gap-3 text-xs uppercase tracking-wide">
                  <strong>{getString(review, 'reviewer_name')}</strong>
                  <span>{getString(review, 'platform')}</span>
                </figcaption>
              </figure>
            )
          })}
        </div>
      </div>
    </section>
  )
}

const REGISTERED_BLOCK_RENDERERS = {
  'acf/menu': MenuSection,
  'acf/top-slides': HeroSlides,
  'acf/text-section': TextSection,
  'acf/feature-section': FeatureSection,
  'acf/image': ImageSection,
  'acf/links': LinksSection,
  'acf/content-grid': ContentGrid,
  'acf/form': FormSection,
  'acf/map': MapSection,
  'acf/html-section': HtmlSection,
  'acf/gallery': Gallery,
  'acf/accordion-section': AccordionSection,
  'acf/plans-availability': PlansAvailability,
  'acf/poi': PointsOfInterest,
  'acf/testimonials': Testimonials,
} satisfies Record<ACFBlockType, React.FC<BlockComponentProps>>

export const EXPLICIT_ACF_PREVIEW_BLOCK_TYPES = Object.freeze(
  Object.keys(REGISTERED_BLOCK_RENDERERS) as ACFBlockType[]
)

/**
 * Helper: Convert Font Awesome class to emoji
 */
function getIconEmoji(iconClass: string): string {
  const iconMap: Record<string, string> = {
    'fa-swimming-pool': '🏊',
    'fa-bell': '🔔',
    'fa-wifi': '📶',
    'fa-sun': '☀️',
    'fa-dumbbell': '💪',
    'fa-glass-cheers': '🥂',
    'fa-dog': '🐕',
    'fa-laptop': '💻',
    'fa-car': '🚗',
    'fa-home': '🏠',
    'fa-building': '🏢',
    'fa-tree': '🌳',
    'fa-coffee': '☕',
    'fa-utensils': '🍽️',
    'fa-shopping-bag': '🛍️',
    'fa-bus': '🚌',
    'fa-train': '🚆'
  }
  
  return iconMap[iconClass] || '✨'
}







