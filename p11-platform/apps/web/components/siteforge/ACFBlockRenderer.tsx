'use client'

// SiteForge: ACF Block Visual Renderer
// Renders ACF block content as styled HTML preview
// Created: December 11, 2025

import React from 'react'

export interface DesignSystem {
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
}

interface BlockRendererProps {
  blockType: string
  content: any
  className?: string
  designSystem?: DesignSystem
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
  
  const colors = designSystem.colors || {}
  const typography = designSystem.typography || {}
  
  return {
    '--brand-primary': colors.primary || '#4F46E5',
    '--brand-secondary': colors.secondary || '#10B981',
    '--brand-accent': colors.accent || '#F59E0B',
    '--brand-background': colors.background || '#FFFFFF',
    '--brand-text': colors.text || '#1F2937',
    '--font-heading': typography.headingFont ? `'${typography.headingFont}', serif` : "'Playfair Display', serif",
    '--font-body': typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : "'Inter', sans-serif",
  } as React.CSSProperties
}

/**
 * Main renderer that delegates to specific block renderers
 */
export function ACFBlockRenderer({ blockType, content, className = '', designSystem }: BlockRendererProps) {
  if (!content || Object.keys(content).length === 0) {
    return (
      <div className={`p-6 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg ${className}`}>
        <div className="flex items-start gap-3">
          <span className="text-yellow-600 dark:text-yellow-400 text-xl">⚠️</span>
          <div>
            <p className="text-yellow-800 dark:text-yellow-200 font-medium">
              Content not generated for this section
            </p>
            <p className="text-yellow-700 dark:text-yellow-300 text-sm mt-1">
              Click this section and describe what content you'd like to add.
            </p>
            <p className="text-yellow-600 dark:text-yellow-400 text-xs mt-2">
              Block type: {blockType}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const renderers: Record<string, React.FC<{ content: any; designSystem?: DesignSystem }>> = {
    'acf/top-slides': HeroSlides,
    'acf/text-section': TextSection,
    'acf/content-grid': ContentGrid,
    'acf/feature-section': FeatureSection,
    'acf/gallery': Gallery,
    'acf/form': FormSection,
    'acf/map': MapSection,
    'acf/links': LinksSection,
    'acf/accordion-section': AccordionSection,
    'acf/image': ImageSection,
    'acf/html-section': HtmlSection,
    'acf/menu': MenuSection,
    'acf/plans-availability': PlansAvailability,
    'acf/poi': PointsOfInterest
  }

  // Try direct match first, then fall back to semantic type mapping
  let resolvedBlockType = blockType
  if (!renderers[blockType]) {
    // Try semantic type mapping
    const mappedType = semanticTypeToBlock[blockType?.toLowerCase()]
    if (mappedType) {
      resolvedBlockType = mappedType
    }
  }
  
  const Renderer = renderers[resolvedBlockType]
  
  if (!Renderer) {
    return (
      <div className={`p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded border border-yellow-200 dark:border-yellow-800 ${className}`}>
        <p className="text-yellow-700 dark:text-yellow-300 text-sm">Unknown block type: {blockType}</p>
        <pre className="text-xs mt-2 text-gray-600">{JSON.stringify(content, null, 2)}</pre>
      </div>
    )
  }

  // Apply design system styles as CSS custom properties
  const brandStyles = getDesignSystemStyles(designSystem)

  return (
    <div className={className} style={brandStyles}>
      <Renderer content={content} designSystem={designSystem} />
    </div>
  )
}

/**
 * Hero Slides - Top carousel with CTAs
 */
function HeroSlides({ content, designSystem }: { content: any; designSystem?: DesignSystem }) {
  const slides = content.slides || []
  const colors = designSystem?.colors || {}
  const typography = designSystem?.typography || {}
  
  // Do not fake complete hero output when content is missing.
  if (slides.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-6">
        <h2
          className="text-lg font-semibold text-amber-900 dark:text-amber-100"
          style={{ fontFamily: typography.headingFont ? `'${typography.headingFont}', serif` : undefined }}
        >
          Hero block is missing structured slide content
        </h2>
        <p className="mt-2 text-sm text-amber-800 dark:text-amber-200">
          Preview intentionally avoids placeholder headline/CTA rendering for this critical section.
          Edit this section to add real hero slides before deploy.
        </p>
        <div className="mt-3 text-xs text-amber-700 dark:text-amber-300">
          Required: slides[headline, subheadline, cta_text, cta_link]
        </div>
      </div>
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
      {slides.map((slide: any, idx: number) => (
        <div key={idx} className="p-8 md:p-12 text-white">
          <div className="max-w-2xl">
            <h2 
              className="text-3xl md:text-4xl font-bold mb-3"
              style={{ fontFamily: typography.headingFont ? `'${typography.headingFont}', serif` : undefined }}
            >
              {slide.headline}
            </h2>
            <p 
              className="text-lg text-gray-200 mb-6"
              style={{ fontFamily: typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : undefined }}
            >
              {slide.subheadline}
            </p>
            <a 
              href={slide.cta_link} 
              className="inline-block text-white font-semibold px-6 py-3 rounded-lg transition hover:opacity-90"
              style={{ 
                backgroundColor: colors.accent || colors.primary || '#4F46E5',
                fontFamily: typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : undefined
              }}
            >
              {slide.cta_text}
            </a>
          </div>
          {slide.image_index !== null && (
            <div className="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
              📷 Image #{slide.image_index}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * Text Section - Headline + content block
 */
function TextSection({ content, designSystem }: { content: any; designSystem?: DesignSystem }) {
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
          {content.headline}
        </h3>
        <div 
          className="prose dark:prose-invert max-w-none text-gray-600 dark:text-gray-300"
          style={{ fontFamily: typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : undefined }}
          dangerouslySetInnerHTML={{ __html: content.content }}
        />
      </div>
    </div>
  )
}

/**
 * Content Grid - Grid of items with icons
 */
function ContentGrid({ content, designSystem }: { content: any; designSystem?: DesignSystem }) {
  const items = content.items || []
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
      {items.map((item: any, idx: number) => (
        <div key={idx} className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-100 dark:border-gray-700">
          {item.icon && (
            <div 
              className="w-12 h-12 rounded-lg flex items-center justify-center mb-4"
              style={{ 
                backgroundColor: iconBgColor || 'rgb(238 242 255)',
                color: colors.primary || '#4F46E5'
              }}
            >
              <span className="text-xl">
                {getIconEmoji(item.icon)}
              </span>
            </div>
          )}
          <h4 
            className="font-semibold text-gray-900 dark:text-white mb-2"
            style={{ fontFamily: typography.headingFont ? `'${typography.headingFont}', serif` : undefined }}
          >
            {item.headline}
          </h4>
          <p 
            className="text-sm text-gray-600 dark:text-gray-400"
            style={{ fontFamily: typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : undefined }}
          >
            {item.description}
          </p>
        </div>
      ))}
    </div>
  )
}

/**
 * Feature Section - Image + text side by side
 */
function FeatureSection({ content, designSystem }: { content: any; designSystem?: DesignSystem }) {
  const isImageLeft = content.layout === 'image-left'
  const colors = designSystem?.colors || {}
  const typography = designSystem?.typography || {}
  
  return (
    <div className={`flex flex-col ${isImageLeft ? 'md:flex-row' : 'md:flex-row-reverse'} gap-8 p-4 items-center`}>
      <div className="w-full md:w-1/2">
        <div className="bg-gray-200 dark:bg-gray-700 rounded-lg aspect-video flex items-center justify-center">
          <span className="text-gray-500 dark:text-gray-400">
            📷 Image #{content.image_index ?? 0}
          </span>
        </div>
      </div>
      <div className="w-full md:w-1/2">
        <h3 
          className="text-2xl font-bold mb-4 text-gray-900 dark:text-white"
          style={{ fontFamily: typography.headingFont ? `'${typography.headingFont}', serif` : undefined }}
        >
          {content.headline}
        </h3>
        <div 
          className="prose dark:prose-invert max-w-none text-gray-600 dark:text-gray-300 mb-6"
          style={{ fontFamily: typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : undefined }}
          dangerouslySetInnerHTML={{ __html: content.content }}
        />
        {content.cta_text && (
          <a 
            href={content.cta_link} 
            className="inline-block text-white font-medium px-5 py-2 rounded-lg transition hover:opacity-90"
            style={{ backgroundColor: colors.primary || '#4F46E5' }}
          >
            {content.cta_text}
          </a>
        )}
      </div>
    </div>
  )
}

/**
 * Gallery - Image grid
 */
function Gallery({ content, designSystem }: { content: any; designSystem?: DesignSystem }) {
  const indices = content.image_indices || []
  const layout = content.layout || 'grid'
  
  return (
    <div className="p-4">
      <div className={`grid ${layout === 'grid' ? 'grid-cols-2 md:grid-cols-3' : 'grid-cols-1'} gap-4`}>
        {indices.map((idx: number) => (
          <div key={idx} className="bg-gray-200 dark:bg-gray-700 rounded-lg aspect-square flex items-center justify-center">
            <span className="text-gray-500 dark:text-gray-400">📷 #{idx}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Form Section - Contact/inquiry form
 */
function FormSection({ content, designSystem }: { content: any; designSystem?: DesignSystem }) {
  const colors = designSystem?.colors || {}
  const typography = designSystem?.typography || {}
  
  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-8 max-w-xl mx-auto">
      <h3 
        className="text-2xl font-bold mb-2 text-gray-900 dark:text-white text-center"
        style={{ fontFamily: typography.headingFont ? `'${typography.headingFont}', serif` : undefined }}
      >
        {content.heading}
      </h3>
      <p 
        className="text-gray-600 dark:text-gray-400 mb-6 text-center"
        style={{ fontFamily: typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : undefined }}
      >
        {content.subheading}
      </p>
      <div className="space-y-4">
        <input 
          type="text" 
          placeholder="Your Name" 
          className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700"
          disabled
        />
        <input 
          type="email" 
          placeholder="Email Address" 
          className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700"
          disabled
        />
        <input 
          type="tel" 
          placeholder="Phone Number" 
          className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700"
          disabled
        />
        <textarea 
          placeholder="Message" 
          rows={3}
          className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700"
          disabled
        />
        <button 
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
function MapSection({ content, designSystem }: { content: any; designSystem?: DesignSystem }) {
  const address = typeof content.address === 'string' ? content.address : ''
  const hasCoordinates =
    typeof content.latitude === 'number' && typeof content.longitude === 'number'
  const hasLocation = address.trim().length > 0 || hasCoordinates

  if (!hasLocation) {
    return (
      <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-6">
        <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
          Map location not configured
        </h4>
        <p className="mt-2 text-sm text-amber-800 dark:text-amber-200">
          Preview skips map placeholders for this critical block. Provide address or coordinates to
          render a trustworthy location summary.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
      <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Location block</h4>
      <div className="mt-2 text-sm text-gray-700 dark:text-gray-300 space-y-1">
        {address && <p>Address: {address}</p>}
        {hasCoordinates && (
          <p>
            Coordinates: {content.latitude}, {content.longitude}
          </p>
        )}
        <p>Zoom: {content.zoom_level || 15}</p>
        {content.show_directions && (
          <p className="text-xs text-gray-500 dark:text-gray-400">Directions enabled</p>
        )}
        <div className="pt-1 text-xs text-gray-500 dark:text-gray-400">
          Live map tiles are intentionally omitted in preview.
        </div>
      </div>
    </div>
  )
}

/**
 * Links Section - CTA buttons
 */
function LinksSection({ content, designSystem }: { content: any; designSystem?: DesignSystem }) {
  const links = content.links || []
  const colors = designSystem?.colors || {}
  
  return (
    <div className="flex flex-wrap gap-4 justify-center p-4">
      {links.map((link: any, idx: number) => (
        <a
          key={idx}
          href={link.url}
          className={`px-6 py-3 rounded-lg font-medium transition hover:opacity-90 ${
            link.style !== 'primary'
              ? 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white'
              : 'text-white'
          }`}
          style={link.style === 'primary' ? { backgroundColor: colors.primary || '#4F46E5' } : undefined}
        >
          {link.text}
        </a>
      ))}
    </div>
  )
}

/**
 * Accordion Section - FAQ style
 */
function AccordionSection({ content, designSystem }: { content: any; designSystem?: DesignSystem }) {
  const items = content.items || []
  const typography = designSystem?.typography || {}
  
  return (
    <div className="space-y-3 p-4">
      {items.map((item: any, idx: number) => (
        <div key={idx} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div 
            className="bg-gray-50 dark:bg-gray-800 px-4 py-3 font-medium text-gray-900 dark:text-white flex justify-between items-center"
            style={{ fontFamily: typography.headingFont ? `'${typography.headingFont}', serif` : undefined }}
          >
            {item.title}
            <span className="text-gray-400">▼</span>
          </div>
          <div 
            className="px-4 py-3 text-gray-600 dark:text-gray-300 prose dark:prose-invert max-w-none"
            style={{ fontFamily: typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : undefined }}
            dangerouslySetInnerHTML={{ __html: item.content }}
          />
        </div>
      ))}
    </div>
  )
}

/**
 * Image Section - Single image
 */
function ImageSection({ content, designSystem }: { content: any; designSystem?: DesignSystem }) {
  const typography = designSystem?.typography || {}
  const sizeClasses: Record<string, string> = {
    full: 'w-full',
    large: 'max-w-4xl mx-auto',
    medium: 'max-w-2xl mx-auto'
  }
  const sizeClass = sizeClasses[String(content.size)] || 'max-w-4xl mx-auto'

  return (
    <div className={`p-4 ${sizeClass}`}>
      <div className="bg-gray-200 dark:bg-gray-700 rounded-lg aspect-video flex items-center justify-center">
        <span className="text-gray-500 dark:text-gray-400">📷 Image #{content.image_index ?? 0}</span>
      </div>
      {content.caption && (
        <p 
          className="text-center text-sm text-gray-500 dark:text-gray-400 mt-2 italic"
          style={{ fontFamily: typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : undefined }}
        >
          {content.caption}
        </p>
      )}
    </div>
  )
}

/**
 * HTML Section - Custom HTML
 */
function HtmlSection({ content, designSystem }: { content: any; designSystem?: DesignSystem }) {
  return (
    <div 
      className="p-4"
      dangerouslySetInnerHTML={{ __html: content.html_content }}
    />
  )
}

/**
 * Menu Section - Navigation links
 */
function MenuSection({ content, designSystem }: { content: any; designSystem?: DesignSystem }) {
  const items = content.menu_items || []
  const typography = designSystem?.typography || {}
  
  return (
    <div className="flex flex-wrap gap-2 justify-center p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
      {items.map((item: string, idx: number) => (
        <span 
          key={idx}
          className="px-4 py-2 bg-white dark:bg-gray-700 rounded-full text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 cursor-pointer transition"
          style={{ fontFamily: typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : undefined }}
        >
          {item}
        </span>
      ))}
    </div>
  )
}

/**
 * Plans Availability - explicit readiness view, no fake inventory placeholders
 */
function PlansAvailability({ content, designSystem }: { content: any; designSystem?: DesignSystem }) {
  const colors = designSystem?.colors || {}
  const typography = designSystem?.typography || {}
  const floorPlans = Array.isArray(content.floor_plans) ? content.floor_plans : []
  
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
          Floor plan inventory unavailable
        </h4>
        <p
          className="text-sm text-gray-700 dark:text-gray-300"
          style={{ fontFamily: typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : undefined }}
        >
          This block depends on real PMS floor-plan data. Preview omits synthetic plans so deploy
          readiness is explicit.
        </p>
        <p className="text-xs text-gray-500 mt-2">
          Data source: {content.data_source || 'yardi'}
        </p>
      </div>
    )
  }
  
  return (
    <div 
      className="rounded-lg p-8 text-center"
      style={{ background: `linear-gradient(135deg, ${gradientFrom} 0%, ${gradientTo} 100%)` }}
    >
      <h4 
        className="text-lg font-semibold text-gray-900 dark:text-white mb-2"
        style={{ fontFamily: typography.headingFont ? `'${typography.headingFont}', serif` : undefined }}
      >
        Floor Plans Available
      </h4>
      <p className="text-sm text-gray-700 dark:text-gray-300">
        {floorPlans.length} plan{floorPlans.length === 1 ? '' : 's'} in preview data
      </p>
      <p 
        className="text-gray-600 dark:text-gray-400 text-sm"
        style={{ fontFamily: typography.bodyFont ? `'${typography.bodyFont}', sans-serif` : undefined }}
      >
        Data source: {content.data_source || 'yardi'}
      </p>
    </div>
  )
}

/**
 * Points of Interest - Neighborhood map
 */
function PointsOfInterest({ content, designSystem }: { content: any; designSystem?: DesignSystem }) {
  const categories = content.categories || []
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
        {content.intro_text}
      </p>
      <div className="bg-gray-200 dark:bg-gray-700 rounded-lg aspect-video flex items-center justify-center mb-4">
        <div className="text-center">
          <span className="text-4xl mb-2 block">📍</span>
          <span className="text-gray-500 dark:text-gray-400">
            Points of Interest Map ({content.radius_miles || 2} mile radius)
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 justify-center">
        {categories.map((cat: string, idx: number) => (
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







