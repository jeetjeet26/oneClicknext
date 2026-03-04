# oneClick SiteForge - Quick Start Guide

Get up and running with oneClick SiteForge in 5 minutes.

## Prerequisites

- WordPress 5.9+
- ACF Pro 6.0+
- PHP 7.4+
- Google Maps API key

## 30-Second Setup

1. **Upload Theme**
   ```bash
   scp -r oneclick-siteforge/ user@server:/wp-content/themes/
   ```

2. **Activate Theme**
   - WordPress Admin → Appearance → Themes → Activate "oneClick SiteForge"

3. **Configure Settings**
   - WordPress Admin → Theme Settings
   - Fill in property info and API keys
   - Click "Publish"

4. **Create Homepage**
   - Pages → Add New
   - Title: "Home"
   - Add "Hero Image Slider" block
   - Settings → Reading → Set as homepage
   - Publish

That's it! Your site is live.

## Adding Blocks to Your Page

1. Open page editor
2. Click "Add Block" button
3. Search for block name (e.g., "Hero", "Gallery", "Form")
4. Fill in block fields
5. Publish

## Common Block Uses

### Hero/Landing Section
Use **Hero Image Slider** block:
- Upload hero images
- Add headline and CTA button
- Enable autoplay

### Feature Showcase
Use **Image + Text Split** block:
- Add image on left or right
- Write feature description
- Add CTA button

### Amenities/Features
Use **Card Grid Layout** block:
- Add icons or images
- Write feature names and descriptions
- Choose 2, 3, or 4 column layout

### Contact Form
Use **Lead Capture Form** block:
- Choose form type (contact/tour)
- Form automatically posts to API
- Redirect URL after submission (optional)

### Floor Plans
Use **Floor Plan Browser** block:
- Connect to Yardi/RentCafe API
- Add filters (bedrooms, sqft, family-friendly)
- Display interactive plans

### Gallery
Use **Photo Gallery** block:
- Upload images
- Choose layout (grid or masonry)
- Click image to open lightbox

### FAQ Section
Use **Expandable FAQ/List** block:
- Add question/answer pairs
- Accordion expands on click
- Fully accessible

### Map
Use **Google Maps Embed** block:
- Shows property location
- Optional directions button
- (Requires Google Maps API key)

### Nearby Amenities
Use **Points of Interest Map** block:
- Shows restaurants, shopping, entertainment, transit
- Interactive markers
- Configurable radius
- (Requires Google Maps API key)

## Theme Settings Reference

**Location Tab:**
- Property Name: Display name
- Address: Full mailing address
- Latitude/Longitude: For map centering
- Phone: Contact number
- Email: Contact email

**APIs Tab:**
- Google Maps Key: Get from Google Cloud Console
- Lead Endpoint: URL where forms post
- Yardi/RentCafe URLs: Optional floor plan APIs

**Social Tab:**
- Facebook, Instagram, Twitter, LinkedIn URLs
- Links appear in footer

## Customizing Colors

Edit `/style.css` and change CSS variables:

```css
:root {
  --color-primary: #1B365D;      /* Main color */
  --color-secondary: #7A8B6F;    /* Secondary */
  --color-accent: #C5A572;       /* Highlight */
  --color-bg: #FAFAF7;           /* Background */
  --color-text: #2D2D2D;         /* Text */
}
```

Save and refresh. All colors update automatically.

## Customizing Fonts

Edit `/functions.php` and change Google Fonts URL:

```php
wp_enqueue_style(
  'google-fonts',
  'https://fonts.googleapis.com/css2?family=YourFont:wght@400;600&display=swap',
  // ...
);
```

Then update font names in `/style.css`:

```css
--font-heading: 'YourFont', serif;
--font-body: 'YourFont', sans-serif;
```

## Mobile Navigation

Mobile menu automatically appears on tablets/phones:
- Hamburger icon in top-right
- Click to expand menu
- Click link to navigate
- Menu closes automatically

## Forms Integration

Forms automatically post to your API endpoint with this JSON:

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "555-1234",
  "form_type": "contact",
  "message": "Message content",
  "timestamp": "2024-03-03T15:30:00Z",
  "page_url": "https://yourdomain.com"
}
```

Return valid JSON with HTTP 200 for success.

## Performance Tips

1. **Optimize Images**
   - Use 1920x1080 for sliders
   - Use 1200x900 for cards
   - Compress with Smush/Imagify

2. **Enable Caching**
   - Install WP Super Cache
   - Configure to cache pages, CSS, JS

3. **Use CDN**
   - CloudFlare (free)
   - Bunny CDN
   - StackPath

4. **Minify Code**
   - Use Autoptimize plugin
   - Or WP Minify

## Troubleshooting

**Maps not showing?**
- Verify API key in Theme Settings
- Check API has Maps JavaScript API enabled
- Ensure key isn't domain-restricted (for localhost)

**Forms not working?**
- Check API endpoint URL is correct
- Verify endpoint returns HTTP 200
- Check browser console for errors

**Blocks not showing?**
- Verify ACF Pro is installed
- Clear page cache
- Refresh browser (Ctrl+F5)

**Styles look wrong?**
- Clear browser cache
- Check CSS file loaded (F12 → Network tab)
- Verify no conflicting plugins

**Navigation not mobile-friendly?**
- Should auto-collapse on mobile
- Click hamburger icon to expand
- Check window width < 768px

## File Locations

- **Theme files:** `/wp-content/themes/oneclick-siteforge/`
- **Blocks:** `/blocks/` folder
- **Styles:** `/assets/css/` folder
- **Scripts:** `/assets/js/` folder
- **Settings:** Dashboard → Theme Settings

## Next Steps

1. ✓ Activate theme
2. ✓ Configure Theme Settings
3. ✓ Add menu items
4. ✓ Create homepage
5. ✓ Add blocks to pages
6. ✓ Upload images
7. ✓ Test on mobile
8. ✓ Enable HTTPS
9. ✓ Setup Google Analytics
10. ✓ Submit sitemap to Google

## Getting Help

- **Documentation:** Read README.md
- **Deployment:** See DEPLOYMENT.md
- **Blocks Guide:** Hover over block titles for help
- **WordPress Docs:** wordpress.org
- **ACF Docs:** advancedcustomfields.com

## Pro Tips

- Use full-width images (1920px wide)
- Add descriptive text to images (for accessibility)
- Keep forms short (3-5 fields max)
- Test on mobile during development
- Use the preview button before publishing
- Check links before going live
- Setup 404 page
- Enable WordPress search

---

Ready to build? Start by creating your first page with the Hero Image Slider block!

For detailed information, see README.md and DEPLOYMENT.md.
