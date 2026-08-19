import type {
  ACFBlockType,
  SiteConfiguration,
} from '@/types/siteforge'

export type PreviewParitySiteConfiguration = SiteConfiguration & {
  brandName: string
  contact: {
    phone: string
    email: string
    address: {
      street: string
      city: string
      state: string
      zip: string
    }
  }
  socialLinks: Record<string, string>
  legalLinks: Array<{
    label: string
    href: string
    external?: boolean
  }>
  footer: SiteConfiguration['footer'] & {
    text: string
  }
}

export const previewParitySiteConfiguration: PreviewParitySiteConfiguration = {
  brandName: 'Juniper House',
  design: {
    colors: {
      primary: '#153f37',
      secondary: '#d8c7a3',
      accent: '#b65f3d',
      background: '#fffdf8',
      text: '#17211f',
    },
    typography: {
      headingFont: 'Source Serif 4',
      bodyFont: 'Inter',
      headingWeight: 600,
    },
    spacing: {
      containerMaxWidth: '1280px',
      sectionPadding: '5rem',
    },
  },
  header: {
    layout: 'logo-left',
    position: 'overlay',
    announcement: {
      enabled: true,
      text: 'Now leasing',
      link: '/floor-plans/',
    },
    cta: {
      enabled: true,
      label: 'Schedule a tour',
      href: 'https://leasing.example.com/tour',
    },
  },
  navigation: {
    style: 'mega',
    items: [
      { id: 'home', label: 'Home', href: '/' },
      { id: 'living', label: 'Living', href: '/living/' },
      {
        id: 'amenities',
        parentId: 'living',
        label: 'Amenities',
        href: '/amenities/',
      },
      {
        id: 'resident',
        label: 'Resident portal',
        href: 'https://resident.example.com',
        external: true,
      },
    ],
  },
  footer: {
    layout: 'columns',
    showNavigation: true,
    showContact: true,
    showSocial: true,
    tagline: 'Considered city living.',
    text: 'Equal Housing Opportunity.',
  },
  media: {
    logoUrl: 'https://assets.example.com/juniper-house.svg',
    logoAlt: 'Juniper House',
    imageTreatment: 'natural',
  },
  motion: {
    level: 'subtle',
    reducedMotion: 'respect',
    reveal: 'fade',
    durationMs: 250,
    easing: 'ease-out',
  },
  behavior: {
    smoothScroll: true,
    externalLinksNewTab: true,
    backToTop: false,
    cookieConsent: 'informational',
  },
  contact: {
    phone: '(555) 010-2020',
    email: 'hello@juniper.example',
    address: {
      street: '120 Juniper Street',
      city: 'Portland',
      state: 'OR',
      zip: '97205',
    },
  },
  socialLinks: {
    instagram: 'https://instagram.com/juniperhouse',
    facebook: 'https://facebook.com/juniperhouse',
  },
  legalLinks: [
    { label: 'Privacy', href: '/privacy/' },
    {
      label: 'Accessibility',
      href: 'https://legal.example.com/accessibility',
      external: true,
    },
  ],
}

export const registeredBlockPreviewFixtures = {
  'acf/menu': {
    menu_items: [
      { label: 'Amenities', link: '/amenities/' },
      { label: 'Resident portal', link: 'https://resident.example.com' },
    ],
  },
  'acf/top-slides': {
    slides: [
      {
        image: {
          url: 'https://assets.example.com/hero.jpg',
          alt: 'Juniper House exterior',
        },
        headline: 'Rooted in the city',
        subheadline: 'Apartments near the river.',
        cta_text: 'Explore residences',
        cta_link: '/floor-plans/',
      },
    ],
  },
  'acf/text-section': {
    headline: 'A thoughtful place to land',
    content: '<p>Comfortable homes with connected neighborhood access.</p>',
    layout: 'left',
    background: 'white',
  },
  'acf/feature-section': {
    image: {
      url: 'https://assets.example.com/lounge.jpg',
      alt: 'Resident lounge',
    },
    headline: 'Spaces to gather',
    content: '<p>A resident lounge and landscaped courtyard.</p>',
    layout: 'image-left',
    cta_text: 'View amenities',
    cta_link: '/amenities/',
  },
  'acf/image': {
    image: {
      url: 'https://assets.example.com/courtyard.jpg',
      alt: 'Landscaped courtyard',
    },
    size: 'large',
    caption: 'The central courtyard.',
  },
  'acf/links': {
    links: [
      { text: 'Apply now', url: 'https://leasing.example.com/apply', style: 'primary' },
    ],
  },
  'acf/content-grid': {
    items: [
      {
        icon: 'fa-wifi',
        headline: 'Connected',
        description: 'Resident Wi-Fi in shared spaces.',
      },
    ],
    columns: '3',
  },
  'acf/form': {
    heading: 'Plan your visit',
    subheading: 'Tell the leasing team when you would like to tour.',
    form_type: 'tour',
    provider: 'p11_lumaleasing',
    consent_text: 'I consent to be contacted about this property.',
  },
  'acf/map': {
    address: '120 Juniper Street, Portland, OR 97205',
    zoom_level: 15,
    show_directions: true,
  },
  'acf/html-section': {
    html_content: '<aside>WordPress-managed embed</aside>',
  },
  'acf/gallery': {
    images: [
      {
        url: 'https://assets.example.com/gallery.jpg',
        alt: 'Fitness studio',
      },
    ],
    layout: 'grid',
  },
  'acf/accordion-section': {
    items: [
      {
        title: 'Are pets welcome?',
        content: '<p>Contact the leasing team for the reviewed pet policy.</p>',
      },
    ],
  },
  'acf/plans-availability': {
    data_source: 'siteforge',
    floor_plans: [
      {
        id: 'a1',
        name: 'A1',
        bedrooms: 1,
        bathrooms: 1,
        sqft_min: 720,
      },
    ],
    display_style: 'cards',
    filter_options: ['bedrooms'],
    show_pricing: false,
    show_availability: false,
    freshness_hours: 24,
  },
  'acf/poi': {
    intro_text: 'Everyday destinations nearby.',
    points: [
      {
        name: 'Riverfront Park',
        category: 'entertainment',
        address: '98 River Street',
      },
    ],
    categories: ['entertainment'],
    radius_miles: 1,
  },
  'acf/testimonials': {
    heading: 'Resident experiences',
    reviews: [
      {
        id: '77777777-7777-4777-8777-777777777777',
        reviewer_name: 'Jordan R.',
        review_text: 'The team made our move straightforward.',
        rating: 5,
        platform: 'google',
        review_date: '2026-07-15T12:00:00.000Z',
      },
    ],
    source: 'reviewflow',
  },
  'acf/offering-browser': {
    heading: 'Available residences',
    offering_kind: 'rental_unit',
    offerings: [
      {
        id: 'offering-a1',
        kind: 'rental_unit',
        name: 'A1',
        attributes: { bedrooms: '1', bathrooms: '1' },
      },
    ],
    catalog_snapshot: {
      captured_at: '2026-08-13T12:00:00.000Z',
      content_hash: 'a'.repeat(64),
      fresh_until: null,
    },
    show_pricing: false,
    show_availability: false,
    conversion_intent: 'tour',
  },
  'acf/entity-directory': {
    heading: 'Our communities',
    entities: [
      { id: 'community-1', name: 'The Aurora', type: 'community' },
    ],
    catalog_snapshot: {
      captured_at: '2026-08-13T12:00:00.000Z',
      content_hash: 'b'.repeat(64),
      fresh_until: null,
    },
    group_by: null,
  },
  'acf/comparison-table': {
    heading: 'Compare options',
    columns: [{ key: 'bedrooms', label: 'Bedrooms' }],
    rows: [
      { id: 'row-a1', label: 'A1', values: { bedrooms: '1' } },
    ],
  },
  'acf/timeline': {
    heading: 'Development timeline',
    milestones: [
      { id: 'opening', date_label: 'Fall 2026', title: 'Opening' },
    ],
  },
  'acf/document-library': {
    heading: 'Resources',
    documents: [
      { id: 'brochure', title: 'Community brochure', url: '/brochure.pdf' },
    ],
  },
  'acf/events-directory': {
    heading: 'Upcoming events',
    events: [
      {
        id: 'event-1',
        name: 'Open house',
        starts_at: '2026-08-20T18:00:00.000Z',
      },
    ],
    catalog_snapshot: {
      captured_at: '2026-08-13T12:00:00.000Z',
      content_hash: 'c'.repeat(64),
      fresh_until: null,
    },
    conversion_intent: 'visit',
  },
  'acf/governed-component': {
    component_key: 'property-highlight@1.0.0',
    descriptor_hash: 'd'.repeat(64),
    render_plan: {
      nodeId: 'root',
      primitive: 'section',
      classes: ['property-highlight'],
      properties: {},
      accessibility: {
        role: 'region',
        name: { field: 'headline' },
        description: null,
        keyboard: [],
        focusPolicy: 'none',
        liveRegion: 'off',
      },
      children: [],
    },
    component_values: {
      headline: 'Property highlight',
    },
  },
} satisfies Record<ACFBlockType, Record<string, unknown>>

export const maliciousHtmlPreviewFixtures = {
  text: {
    headline: 'Sanitized text',
    content:
      '<p onclick="steal()">Welcome <strong>home</strong>.</p><script>alert("unsafe")</script>',
  },
  feature: {
    headline: 'Sanitized feature',
    content:
      '<p><a href="jav&#x61;script:alert(1)" onmouseover="steal()">Learn more</a></p>',
  },
  accordion: {
    items: [
      {
        title: 'Sanitized answer',
        content:
          '<p>Reviewed answer.</p><iframe src="https://attacker.example"></iframe><img src=x onerror=steal()>',
      },
    ],
  },
} as const
