# oneClick SiteForge - WordPress Theme

A production-ready WordPress theme designed for the oneClick SaaS platform that generates apartment community websites from AI-generated blueprints.

## Requirements

- WordPress 5.9+
- PHP 7.4+
- ACF Pro 6.0+ (Advanced Custom Fields Pro)
- Google Maps API key (for location features)

## Installation

1. Upload the `oneclick-siteforge` folder to `/wp-content/themes/`
2. Activate the theme in WordPress Admin
3. Install and activate ACF Pro if not already installed
4. Configure Theme Settings (see Configuration section below)

## Configuration

### Theme Settings (Dashboard > Theme Settings)

The theme includes an options page at **Dashboard > Theme Settings** where you must configure:

**Property Information:**
- Property Name
- Property Address
- Property Latitude & Longitude (for maps)
- Property Phone
- Property Email

**API Configuration:**
- Google Maps API Key (required for all map features)
- Lead Capture API Endpoint (URL where form submissions are posted)
- Yardi API URL (optional, for floor plans)
- RentCafe API URL (optional, for floor plans)

**Social Media Links:**
- Facebook URL
- Instagram URL
- Twitter URL
- LinkedIn URL

All fields are optional except for Google Maps API key if you use map blocks.

## Theme Features

### 14 Custom ACF Blocks

The theme registers 14 custom ACF blocks that can be added to any page via the block editor:

1. **Hero Image Slider** (`acf/top-slides`)
   - Full-width image carousel with text overlay and CTA buttons
   - Configurable autoplay and overlay styles

2. **Rich Text Content** (`acf/text-section`)
   - Flexible text section with centered or left-aligned layouts
   - Optional background color

3. **Card Grid Layout** (`acf/content-grid`)
   - Responsive grid of cards with icons/images and text
   - Configurable column count (2, 3, or 4)

4. **Image + Text Split** (`acf/feature-section`)
   - Two-column layout alternating image and text
   - Includes optional CTA button

5. **CTA Button Group** (`acf/links`)
   - Group of styled buttons with primary/secondary styles

6. **Floor Plan Browser** (`acf/plans-availability`)
   - Interactive floor plan display with filtering
   - Supports Yardi and RentCafe API integration

7. **Lead Capture Form** (`acf/form`)
   - Contact or tour request form
   - Configurable API endpoint and redirect URL

8. **Photo Gallery** (`acf/gallery`)
   - Responsive gallery with lightbox functionality
   - Grid or masonry layout options

9. **Single Hero Image** (`acf/image`)
   - Full-width or contained image with optional caption
   - Lazy-loaded for performance

10. **Google Maps Embed** (`acf/map`)
    - Interactive map showing property location
    - Optional directions link

11. **Points of Interest Map** (`acf/poi`)
    - Interactive map with nearby amenities
    - Filters for restaurants, shopping, entertainment, transit

12. **Sub-Navigation** (`acf/menu`)
    - Horizontal pill/tab navigation for in-page sections

13. **Expandable FAQ/List** (`acf/accordion-section`)
    - Accordion with expand/collapse functionality
    - Fully accessible (WCAG compliant)

14. **Raw HTML** (`acf/html-section`)
    - Custom HTML embed block (for walk scores, custom widgets, etc.)

## Design System

### Typography
- **Headings:** Cormorant Garamond (serif)
- **Body:** Inter (sans-serif)

### Color Palette
- **Primary:** Deep Navy (#1B365D)
- **Secondary:** Mountain Sage (#7A8B6F)
- **Accent:** Aurora Gold (#C5A572)
- **Background:** Warm White (#FAFAF7)
- **Text:** Charcoal (#2D2D2D)

All colors are CSS custom properties and can be customized in `style.css`.

### Spacing
- **xs:** 0.5rem
- **sm:** 1rem
- **md:** 1.5rem
- **lg:** 2rem
- **xl:** 3rem
- **xxl:** 4rem

### Layout
- Max content width: 1200px
- Responsive breakpoints: 768px, 1024px, 1200px
- Generous whitespace for luxury aesthetic

## File Structure

```
oneclick-siteforge/
├── style.css                    # Theme declaration & base styles
├── functions.php                # Theme setup & ACF registration
├── theme.json                   # Block editor settings
├── header.php                   # Site header
├── footer.php                   # Site footer
├── index.php                    # Fallback template
├── page.php                     # Page template
├── assets/
│   ├── css/
│   │   ├── blocks.css          # Block-specific styles
│   │   └── layout.css          # Header/footer styles
│   └── js/
│       ├── slider.js           # Swiper.js integration
│       ├── accordion.js        # Accordion functionality
│       ├── gallery.js          # GLightbox integration
│       ├── poi-map.js          # Points of interest map
│       ├── plans.js            # Floor plans browser
│       ├── form-handler.js     # Form submission
│       └── mobile-menu.js      # Mobile navigation
├── blocks/
│   ├── top-slides.php
│   ├── text-section.php
│   ├── content-grid.php
│   ├── feature-section.php
│   ├── links.php
│   ├── plans-availability.php
│   ├── form.php
│   ├── gallery.php
│   ├── image.php
│   ├── map.php
│   ├── poi.php
│   ├── menu.php
│   ├── accordion-section.php
│   └── html-section.php
├── inc/
│   ├── template-tags.php       # Custom template functions
│   └── block-utilities.php     # Block helper functions
└── acf-json/                   # ACF field group exports
```

## External Libraries

The theme uses the following CDN-hosted libraries:

- **Google Fonts** - Cormorant Garamond & Inter fonts
- **FontAwesome 6** - Icon library
- **Swiper.js** - Image carousel/slider
- **GLightbox** - Image lightbox gallery
- **Google Maps API** - Map and POI functionality

## Development

### Adding Custom Styles

Edit `assets/css/blocks.css` for block styles or `assets/css/layout.css` for layout styles.

### Adding Custom JavaScript

Create new files in `assets/js/` and enqueue them in `functions.php` using `wp_enqueue_script()`.

### Customizing Blocks

Edit the corresponding block template in `blocks/` directory. All block files include proper escaping and security checks.

## Security

All output is properly escaped using WordPress escaping functions:
- `esc_html()` - HTML content
- `esc_attr()` - HTML attributes
- `esc_url()` - URLs
- `wp_kses_post()` - Rich HTML content

All form data is validated and sanitized before output.

## Accessibility

The theme is built with WCAG 2.1 AA accessibility standards:
- Semantic HTML structure
- ARIA labels and roles
- Keyboard navigation support
- Color contrast ratios
- Focus indicators
- Skip links

## Performance

- Lazy loading for images
- Optimized CSS/JS file loading
- Minimal external dependencies
- Responsive image sizes
- Efficient grid layouts

## Customization

### Changing Colors

Edit CSS custom properties in `style.css`:

```css
:root {
  --color-primary: #1B365D;
  --color-secondary: #7A8B6F;
  --color-accent: #C5A572;
  /* ... etc ... */
}
```

### Changing Fonts

Edit the Google Fonts URL in `functions.php` and update the font-family properties in `style.css`.

### Adding Custom Blocks

1. Create a new file in `blocks/` with the block template
2. Register the block in `functions.php` using `acf_register_block_type()`
3. Add ACF field groups using the `acf_add_local_field_group()` function

## Troubleshooting

### Maps not showing
- Verify Google Maps API key is set in Theme Settings
- Check that the API key has Maps API enabled
- Ensure API key isn't restricted to specific domains (if testing locally)

### Forms not submitting
- Verify API endpoint is set in Theme Settings
- Check browser console for JavaScript errors
- Ensure CORS is enabled on the API endpoint

### Blocks not registering
- Verify ACF Pro is installed and activated
- Check WordPress error logs for PHP errors
- Clear WordPress cache if using a caching plugin

### Styles not loading
- Clear browser cache (Ctrl+F5 or Cmd+Shift+R)
- Check that all CSS files are in correct locations
- Verify file permissions are correct (644)

## Support

For issues, questions, or contributions, contact the oneClick development team.

## License

GPL-2.0+

## Changelog

### Version 1.0.0
- Initial release
- 14 ACF blocks
- Full theme styling and layouts
- Mobile responsive design
- Accessibility compliance
