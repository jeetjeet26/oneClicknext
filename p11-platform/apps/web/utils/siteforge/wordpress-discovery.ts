// WordPress capability discovery
// Talks directly to the oneclick-siteforge theme's REST API
// (/wp-json/siteforge/v1/*) over HTTP. Falls back to the theme's known
// static capabilities when no live instance is configured or reachable, and
// says so in logs, so degraded discovery is visible instead of silent.

import { ACF_BLOCK_TYPES } from '@/types/siteforge'
import type {
  WordPressCapabilities,
  ACFBlockSchema,
  ThemeDesignTokens,
} from '@/utils/mcp/wordpress-client'

const DISCOVERY_TIMEOUT_MS = Number(process.env.SITEFORGE_DISCOVERY_TIMEOUT_MS || 10000)

type DiscoveryTarget = {
  baseUrl: string
  username?: string
  password?: string
}

function resolveDiscoveryTarget(): DiscoveryTarget | null {
  const baseUrl = process.env.SITEFORGE_WP_URL?.trim()
  if (!baseUrl) {
    return null
  }
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    username: process.env.SITEFORGE_WP_USERNAME,
    password: process.env.SITEFORGE_WP_APP_PASSWORD,
  }
}

async function fetchJson(target: DiscoveryTarget, path: string): Promise<unknown> {
  const headers: Record<string, string> = {}
  if (target.username && target.password) {
    headers.Authorization = `Basic ${Buffer.from(
      `${target.username}:${target.password}`
    ).toString('base64')}`
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS)
  try {
    const response = await fetch(`${target.baseUrl}/wp-json/siteforge/v1${path}`, {
      headers,
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`GET ${path} failed with status ${response.status}`)
    }
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Discover live WordPress capabilities, or fall back to the theme's known
 * static capability set.
 */
export async function discoverWordPressCapabilities(): Promise<WordPressCapabilities> {
  const target = resolveDiscoveryTarget()

  if (target) {
    try {
      const [abilities, schemas, tokens] = await Promise.all([
        fetchJson(target, '/abilities'),
        fetchJson(target, '/acf-schemas'),
        fetchJson(target, '/design-tokens'),
      ])
      return mapLiveCapabilities(
        abilities as Record<string, unknown>,
        schemas as Record<string, unknown>,
        tokens as Record<string, unknown>
      )
    } catch (error) {
      console.warn(
        `⚠️ [wordpress-discovery] Live discovery against ${target.baseUrl} failed; using built-in theme capabilities:`,
        error instanceof Error ? error.message : error
      )
    }
  } else {
    console.warn(
      '⚠️ [wordpress-discovery] SITEFORGE_WP_URL not configured; using built-in theme capabilities'
    )
  }

  return getBuiltinThemeCapabilities()
}

function mapLiveCapabilities(
  abilities: Record<string, unknown>,
  schemas: Record<string, unknown>,
  tokens: Record<string, unknown>
): WordPressCapabilities {
  const theme = (abilities.theme || {}) as Record<string, unknown>
  const caps = (abilities.capabilities || {}) as Record<string, unknown>
  const colors = ((tokens.colors || {}) as Record<string, unknown>)
  const typography = ((tokens.typography || {}) as Record<string, unknown>)
  const spacing = ((tokens.spacing || {}) as Record<string, unknown>)

  return {
    availableBlocks: Array.isArray(abilities.available_blocks)
      ? (abilities.available_blocks as string[])
      : [...ACF_BLOCK_TYPES],
    blockSchemas: schemas as Record<string, ACFBlockSchema>,
    designTokens: {
      colors: {
        primary: String(colors.primary || '#1a1a1a'),
        secondary: String(colors.secondary || '#c9a96e'),
        availableVariants: Array.isArray(colors.available_variants)
          ? (colors.available_variants as string[])
          : [],
      },
      typography: {
        availableFonts: Array.isArray(typography.available_fonts)
          ? (typography.available_fonts as string[])
          : [],
        headingScales: Array.isArray(typography.heading_scales)
          ? (typography.heading_scales as string[])
          : [],
      },
      spacing: {
        availableScales: Array.isArray(spacing.available_scales)
          ? (spacing.available_scales as string[])
          : [],
        presets: (spacing.presets || {}) as Record<string, unknown>,
      },
    },
    theme: {
      name: String(theme.name || 'oneclick-siteforge'),
      version: String(theme.version || '1.0.0'),
      supports: (theme.supports || {}) as Record<string, boolean>,
    },
    plugins: Array.isArray(abilities.plugins) ? (abilities.plugins as string[]) : [],
    capabilities: {
      canCreatePages: caps.can_create_pages !== false,
      canUploadMedia: caps.can_upload_media !== false,
      canModifyTheme: caps.can_modify_theme === true,
      canInstallPlugins: caps.can_install_plugins === true,
      maxUploadSizeMb: Number(caps.max_upload_size_mb || 100),
    },
  }
}

/**
 * Static capabilities matching wordpress-theme/oneclick-siteforge.
 * Field names mirror the ACF field groups in the theme's acf-json directory.
 */
export function getBuiltinThemeCapabilities(): WordPressCapabilities {
  return {
    availableBlocks: [...ACF_BLOCK_TYPES],
    blockSchemas: getBuiltinBlockSchemas(),
    designTokens: getBuiltinDesignTokens(),
    theme: {
      name: 'oneclick-siteforge',
      version: '1.0.0',
      supports: { acf_blocks: true, classic_menus: true, block_templates: false },
    },
    plugins: ['advanced-custom-fields-pro'],
    capabilities: {
      canCreatePages: true,
      canUploadMedia: true,
      canModifyTheme: false,
      canInstallPlugins: false,
      maxUploadSizeMb: 100,
    },
  }
}

function getBuiltinDesignTokens(): ThemeDesignTokens {
  return {
    colors: {
      primary: '#1a1a1a',
      secondary: '#c9a96e',
      availableVariants: ['primary', 'secondary', 'accent', 'neutral'],
    },
    typography: {
      availableFonts: ['Cormorant Garamond', 'Inter'],
      headingScales: ['compact', 'balanced', 'luxury'],
    },
    spacing: {
      availableScales: ['tight', 'balanced', 'luxury'],
      presets: {
        tight: { section: '4rem', container: '1200px' },
        balanced: { section: '6rem', container: '1400px' },
        luxury: { section: '8rem', container: '1600px' },
      },
    },
  }
}

// Field names below mirror the theme's ACF field groups in
// wordpress-theme/oneclick-siteforge/acf-json/ exactly (which in turn mirror
// the block render templates). These names are a hard contract: content
// emitted under any other key will not hydrate on a deployed site.
function getBuiltinBlockSchemas(): Record<string, ACFBlockSchema> {
  return {
    'acf/top-slides': {
      label: 'Hero Image Slider',
      description: 'Full-width image slider with text overlay and CTA button',
      fields: {
        slides: {
          type: 'repeater',
          description:
            'Rows with image (image), headline (text), subheadline (text), cta_text (text), cta_link (url)',
        },
        autoplay: { type: 'true_false', default: true },
        overlay_style: { type: 'select', choices: ['gradient', 'light', 'dark'] },
      },
    },
    'acf/text-section': {
      label: 'Rich Text Content',
      description: 'Centered or left-aligned rich text content block',
      fields: {
        headline: { type: 'text' },
        subheading: { type: 'text', description: 'Note: subheading, not subheadline' },
        content: { type: 'wysiwyg' },
        layout: { type: 'select', choices: ['center', 'left'] },
        background: { type: 'select', choices: ['white', 'light', 'dark'] },
      },
    },
    'acf/content-grid': {
      label: 'Card Grid Layout',
      description: 'Responsive card grid with icons/images and text',
      fields: {
        items: {
          type: 'repeater',
          description:
            'Rows with image (image), icon (text, FontAwesome class), headline (text), description (textarea)',
        },
        columns: { type: 'select', choices: ['2', '3', '4'], default: '3' },
      },
    },
    'acf/feature-section': {
      label: 'Image + Text Split',
      description: 'Two-column layout with image and text content',
      fields: {
        image: { type: 'image' },
        headline: { type: 'text' },
        content: { type: 'wysiwyg' },
        layout: { type: 'select', choices: ['image-left', 'image-right'] },
        cta_text: { type: 'text' },
        cta_link: { type: 'url' },
      },
    },
    'acf/links': {
      label: 'CTA Button Group',
      description: 'Group of styled CTA buttons',
      fields: {
        links: {
          type: 'repeater',
          description: 'Rows with text (text), url (url), style (select: primary|secondary)',
        },
      },
    },
    'acf/plans-availability': {
      label: 'Floor Plan Browser',
      description: 'Interactive floor plan browser fed by Yardi/RentCafe theme options',
      fields: {
        data_source: { type: 'select', choices: ['yardi', 'rentcafe'] },
        display_style: { type: 'select', choices: ['interactive', 'list'] },
        filter_options: {
          type: 'checkbox',
          choices: ['bedrooms', 'square_footage', 'family_features'],
        },
      },
    },
    'acf/form': {
      label: 'Lead Capture Form',
      description: 'Lead capture form (contact/tour request)',
      fields: {
        heading: { type: 'text', description: 'Note: heading, not headline' },
        subheading: { type: 'text', description: 'Note: subheading, not subheadline' },
        form_type: { type: 'select', choices: ['contact', 'tour'] },
        redirect_url: { type: 'url' },
      },
    },
    'acf/gallery': {
      label: 'Photo Gallery',
      description: 'Responsive photo gallery with lightbox',
      fields: {
        images: { type: 'gallery' },
        layout: { type: 'select', choices: ['grid', 'masonry'] },
      },
    },
    'acf/image': {
      label: 'Single Hero Image',
      description: 'Full-width or contained image with caption',
      fields: {
        image: { type: 'image', required: true },
        size: { type: 'select', choices: ['full', 'large', 'medium'] },
        caption: { type: 'text' },
      },
    },
    'acf/map': {
      label: 'Google Maps Embed',
      description:
        'Google Maps embed for property location (address comes from theme options)',
      fields: {
        zoom_level: { type: 'number', min: 1, max: 21, default: 15 },
        show_directions: { type: 'true_false' },
      },
    },
    'acf/poi': {
      label: 'Points of Interest Map',
      description: 'Interactive map with points of interest around the property',
      fields: {
        intro_text: { type: 'textarea' },
        categories: {
          type: 'checkbox',
          required: true,
          choices: ['restaurants', 'shopping', 'entertainment', 'transit'],
        },
        radius_miles: { type: 'number', default: 1 },
      },
    },
    'acf/menu': {
      label: 'Sub-Navigation',
      description: 'Horizontal navigation menu for in-page sections',
      fields: {
        menu_items: {
          type: 'repeater',
          description: 'Rows with label (text), link (url)',
        },
      },
    },
    'acf/accordion-section': {
      label: 'Expandable FAQ/List',
      description: 'Expandable accordion for FAQ or lists',
      fields: {
        items: {
          type: 'repeater',
          description: 'Rows with title (text), content (wysiwyg)',
        },
      },
    },
    'acf/html-section': {
      label: 'Raw HTML',
      description: 'Raw HTML for custom embeds (sanitized via wp_kses_post)',
      fields: {
        html_content: { type: 'textarea' },
      },
    },
  }
}
