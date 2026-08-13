import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const siteForgeAcfOutputDir = path.resolve(
  appDir,
  '../../../wordpress-theme/oneclick-siteforge/acf-json'
)

const text = (name, label = name) => ({ name, label, type: 'text' })
const url = (name, label = name) => ({ name, label, type: 'url' })
const image = (name, label = name) => ({
  name,
  label,
  type: 'image',
  return_format: 'id',
  preview_size: 'medium',
})
const select = (name, choices, defaultValue) => ({
  name,
  label: name,
  type: 'select',
  choices: Object.fromEntries(choices.map((choice) => [choice, choice])),
  default_value: defaultValue,
})
const repeater = (name, subFields) => ({
  name,
  label: name,
  type: 'repeater',
  layout: 'block',
  button_label: `Add ${name.replaceAll('_', ' ')}`,
  sub_fields: subFields,
})

export const siteForgeAcfDefinitions = {
  'top-slides': [
    repeater('slides', [
      image('image'),
      text('headline'),
      text('subheadline'),
      text('cta_text'),
      url('cta_link'),
    ]),
    { name: 'autoplay', label: 'autoplay', type: 'true_false', default_value: 1 },
    select('overlay_style', ['gradient', 'light', 'dark'], 'gradient'),
    select(
      'variant',
      ['cinematic', 'editorial', 'split', 'panoramic', 'immersive', 'minimal'],
      'cinematic'
    ),
  ],
  'text-section': [
    text('headline'),
    text('subheading'),
    { name: 'content', label: 'content', type: 'wysiwyg' },
    select('layout', ['center', 'left'], 'center'),
    select('background', ['white', 'light', 'dark'], 'white'),
    select('variant', ['editorial', 'contained', 'lead'], 'editorial'),
  ],
  'feature-section': [
    image('image'),
    text('headline'),
    { name: 'content', label: 'content', type: 'wysiwyg' },
    select('layout', ['image-left', 'image-right'], 'image-left'),
    text('cta_text'),
    url('cta_link'),
    select(
      'variant',
      ['alternating', 'bleed', 'framed', 'spotlight', 'collage', 'compact'],
      'alternating'
    ),
  ],
  image: [
    image('image'),
    select('size', ['full', 'large', 'medium'], 'large'),
    text('caption'),
    select('variant', ['full-bleed', 'contained'], 'contained'),
  ],
  links: [
    repeater('links', [
      text('text'),
      url('url'),
      select('style', ['primary', 'secondary'], 'primary'),
    ]),
    select('variant', ['inline', 'banner', 'sticky'], 'inline'),
  ],
  'content-grid': [
    repeater('items', [
      image('image'),
      text('icon'),
      text('headline'),
      { name: 'description', label: 'description', type: 'textarea' },
    ]),
    select('columns', ['2', '3', '4'], '3'),
    select(
      'variant',
      ['amenity-grid', 'tabs', 'editorial', 'bento', 'icon-list', 'carousel'],
      'amenity-grid'
    ),
  ],
  form: [
    text('heading'),
    text('subheading'),
    select('form_type', ['contact', 'tour', 'register'], 'contact'),
    url('redirect_url'),
    select('provider', ['p11_lumaleasing'], 'p11_lumaleasing'),
    { name: 'consent_text', label: 'consent_text', type: 'textarea' },
    select('variant', ['card', 'split', 'minimal'], 'card'),
  ],
  map: [
    text('address'),
    { name: 'latitude', label: 'latitude', type: 'number' },
    { name: 'longitude', label: 'longitude', type: 'number' },
    { name: 'zoom_level', label: 'zoom_level', type: 'number', default_value: 15 },
    { name: 'show_directions', label: 'show_directions', type: 'true_false', default_value: 1 },
    select('variant', ['standard', 'immersive'], 'standard'),
  ],
  'html-section': [
    { name: 'html_content', label: 'html_content', type: 'wysiwyg' },
    select('variant', ['contained', 'full-width'], 'contained'),
  ],
  gallery: [
    { name: 'images', label: 'images', type: 'gallery', return_format: 'id' },
    select('layout', ['grid', 'masonry'], 'grid'),
    select(
      'variant',
      ['categorized', 'masonry', 'lightbox', 'filmstrip', 'mosaic', 'full-bleed'],
      'lightbox'
    ),
  ],
  'accordion-section': [
    repeater('items', [
      text('title'),
      { name: 'content', label: 'content', type: 'wysiwyg' },
    ]),
    select('variant', ['bordered', 'minimal'], 'bordered'),
  ],
  'plans-availability': [
    text('data_source'),
    select('display_style', ['cards', 'interactive', 'list'], 'cards'),
    {
      name: 'filter_options',
      label: 'filter_options',
      type: 'checkbox',
      choices: Object.fromEntries(
        ['bedrooms', 'bathrooms', 'square_footage', 'price', 'availability'].map(
          (choice) => [choice, choice]
        )
      ),
    },
    { name: 'show_pricing', label: 'show_pricing', type: 'true_false', default_value: 1 },
    { name: 'show_availability', label: 'show_availability', type: 'true_false', default_value: 1 },
    { name: 'freshness_hours', label: 'freshness_hours', type: 'number', default_value: 168 },
    select('variant', ['cards', 'details', 'preleasing'], 'cards'),
  ],
  poi: [
    { name: 'intro_text', label: 'intro_text', type: 'textarea' },
    repeater('points', [
      text('name'),
      text('category'),
      text('address'),
      { name: 'distance_miles', label: 'distance_miles', type: 'number' },
      { name: 'travel_time_minutes', label: 'travel_time_minutes', type: 'number' },
      url('source_url'),
    ]),
    {
      name: 'categories',
      label: 'categories',
      type: 'checkbox',
      choices: Object.fromEntries(
        ['restaurants', 'shopping', 'entertainment', 'transit', 'parks'].map(
          (choice) => [choice, choice]
        )
      ),
    },
    { name: 'radius_miles', label: 'radius_miles', type: 'number', default_value: 1 },
    select('variant', ['narrative', 'map-list', 'editorial'], 'narrative'),
  ],
  testimonials: [
    text('heading'),
    repeater('reviews', [
      text('id'),
      text('reviewer_name'),
      { name: 'review_text', label: 'review_text', type: 'textarea' },
      { name: 'rating', label: 'rating', type: 'number', min: 1, max: 5 },
      text('platform'),
      text('review_date'),
    ]),
    select('source', ['reviewflow'], 'reviewflow'),
    select('variant', ['cards', 'spotlight', 'carousel'], 'cards'),
  ],
  menu: [
    repeater('menu_items', [text('label'), url('link')]),
    select('variant', ['standard', 'sticky-cta'], 'standard'),
  ],
}

function withKeys(block, field, index, parent = '') {
  const keyBase = `${block}_${parent}${field.name}`.replaceAll('-', '_')
  return {
    key: `field_siteforge_${keyBase}_${index}`,
    ...field,
    sub_fields: field.sub_fields?.map((subField, subIndex) =>
      withKeys(block, subField, subIndex, `${field.name}_`)
    ),
  }
}

export function renderSiteForgeAcfGroups() {
  return Object.fromEntries(
    Object.entries(siteForgeAcfDefinitions).map(([block, fields]) => {
      const group = {
        key: `group_siteforge_${block.replaceAll('-', '_')}`,
        title: `SiteForge ${block.replaceAll('-', ' ')}`,
        fields: fields.map((field, index) => withKeys(block, field, index)),
        location: [
          [
            {
              param: 'block',
              operator: '==',
              value: `acf/${block}`,
            },
          ],
        ],
        menu_order: 0,
        position: 'normal',
        style: 'default',
        label_placement: 'top',
        instruction_placement: 'label',
        active: true,
        description: 'Versioned SiteForge block contract.',
        show_in_rest: 1,
        modified: 1785441600,
      }
      const filename = `group_siteforge_${block.replaceAll('-', '_')}.json`
      return [filename, `${JSON.stringify(group, null, 2)}\n`]
    })
  )
}

async function existingGeneratedFiles(outputDirectory) {
  try {
    return (await readdir(outputDirectory))
      .filter((filename) => /^group_siteforge_.+\.json$/.test(filename))
      .sort()
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

export async function generateSiteForgeAcf({
  outputDirectory = siteForgeAcfOutputDir,
  check = false,
} = {}) {
  const rendered = renderSiteForgeAcfGroups()
  const expectedFiles = Object.keys(rendered).sort()
  const existingFiles = await existingGeneratedFiles(outputDirectory)

  if (check) {
    const drift = []
    for (const filename of expectedFiles) {
      try {
        const actual = await readFile(
          path.join(outputDirectory, filename),
          'utf8'
        )
        if (actual !== rendered[filename]) drift.push(`${filename} differs`)
      } catch (error) {
        if (error?.code === 'ENOENT') drift.push(`${filename} is missing`)
        else throw error
      }
    }
    for (const filename of existingFiles) {
      if (!rendered[filename]) drift.push(`${filename} is stale`)
    }
    if (drift.length) {
      throw new Error(
        `SiteForge ACF schema drift detected:\n- ${drift.join('\n- ')}\nRun npm run theme:acf:generate and commit the generated schemas.`
      )
    }
    return { count: expectedFiles.length, files: expectedFiles }
  }

  await mkdir(outputDirectory, { recursive: true })
  for (const filename of existingFiles) {
    if (!rendered[filename]) {
      await rm(path.join(outputDirectory, filename))
    }
  }
  await Promise.all(
    expectedFiles.map((filename) =>
      writeFile(path.join(outputDirectory, filename), rendered[filename])
    )
  )
  return { count: expectedFiles.length, files: expectedFiles }
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const command = process.argv[2]
  if (command && command !== '--check') {
    throw new Error(`Unknown command ${command}`)
  }
  const result = await generateSiteForgeAcf({ check: command === '--check' })
  console.log(
    `${command === '--check' ? 'Verified' : 'Generated'} ${result.count} SiteForge ACF field groups.`
  )
}
