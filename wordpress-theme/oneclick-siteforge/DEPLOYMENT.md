# oneClick SiteForge - Deployment Guide

Complete guide for deploying the oneClick SiteForge theme to production.

## Pre-Deployment Checklist

- [ ] WordPress 5.9+ installed
- [ ] PHP 7.4+ running
- [ ] ACF Pro 6.0+ installed and activated
- [ ] HTTPS enabled on the domain
- [ ] WordPress security plugins installed
- [ ] Database backed up
- [ ] Staging environment tested

## Installation Steps

### 1. Upload Theme Files

```bash
# Via SFTP or file manager
Upload oneclick-siteforge/ to /wp-content/themes/

# Or via SSH
scp -r oneclick-siteforge/ user@domain.com:/path/to/wordpress/wp-content/themes/
```

### 2. Activate Theme

1. Go to WordPress Admin Dashboard
2. Navigate to Appearance > Themes
3. Find "oneClick SiteForge" and click "Activate"

### 3. Install ACF Pro

If not already installed:

1. Go to Appearance > Themes > Add New
2. Upload ACF Pro plugin or use license key
3. Activate the plugin

### 4. Configure Theme Settings

1. Go to Dashboard > Theme Settings
2. Fill in all required fields:

   **Property Information:**
   - Property Name: [Apartment community name]
   - Property Address: [Full address]
   - Property Latitude: [GPS latitude]
   - Property Longitude: [GPS longitude]
   - Phone: [Contact number]
   - Email: [Contact email]

   **API Keys:**
   - Google Maps API Key: [Get from Google Cloud Console]
   - Lead Capture Endpoint: [URL of lead API]
   - Yardi URL: [Optional]
   - RentCafe URL: [Optional]

   **Social Media:**
   - Facebook, Instagram, Twitter, LinkedIn URLs

3. Click "Publish"

### 5. Create Homepage

1. Go to Pages > Add New
2. Title: "Home"
3. Set as Homepage:
   - Go to Settings > Reading
   - Select "A static page (select below)"
   - Choose your homepage
   - Click "Save Changes"

4. Add blocks to homepage:
   - Click "Add Block"
   - Search for "Hero Image Slider" or other blocks
   - Configure block fields
   - Publish page

### 6. Setup Navigation Menu

1. Go to Appearance > Menus
2. Create new menu (name it "Main Menu")
3. Add pages/links
4. Display location: "Primary Menu"
5. Save menu

## Obtaining Required API Keys

### Google Maps API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project
3. Enable these APIs:
   - Google Maps JavaScript API
   - Google Places API
   - Geocoding API
4. Go to Credentials > Create API Key
5. Restrict key to:
   - HTTP referrers: `https://yourdomain.com/*`
   - APIs: Google Maps JavaScript API, Places API, Geocoding API
6. Copy the API key to Theme Settings

### Lead Capture API Endpoint

Your lead capture API should accept POST requests with this JSON structure:

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "555-1234",
  "message": "Interested in the 2BR unit",
  "form_type": "contact",
  "tour_date": "2024-03-15",
  "tour_time": "10:00",
  "timestamp": "2024-03-03T15:30:00Z",
  "page_url": "https://yourdomain.com/page",
  "consent": true
}
```

Response should be valid JSON with HTTP 200 status.

## Production Optimization

### 1. Enable Caching

Install a caching plugin:
- WP Super Cache
- W3 Total Cache
- LiteSpeed Cache

Configure to cache:
- Page content
- CSS/JS files
- Images

### 2. Optimize Images

Use an image optimization plugin:
- Smush
- Imagify
- Shortpixel

Recommended image sizes:
- Slider: 1920x800px (or larger)
- Cards: 400x400px
- Gallery: 1200x900px

### 3. Minify CSS/JS

Use a minification plugin or configure in theme:
- WP Minify
- Autoptimize
- Asset CleanUp

### 4. Enable GZIP Compression

Add to `.htaccess`:

```apache
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/plain text/xml text/css text/javascript application/javascript
</IfModule>
```

### 5. Configure CDN (Optional)

For global audiences:
- CloudFlare (free tier available)
- StackPath
- Bunny CDN

### 6. SSL Certificate

Ensure HTTPS is configured:
- Use Let's Encrypt (free)
- Update WordPress URL in Settings
- Force HTTPS via `.htaccess`

```apache
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
```

## Security Hardening

### 1. Disable File Editing

Add to `wp-config.php`:
```php
define('DISALLOW_FILE_EDIT', true);
```

### 2. Disable Directory Listing

Add to `.htaccess`:
```apache
Options -Indexes
```

### 3. Secure wp-admin

Add to `.htaccess`:
```apache
<FilesMatch "^(wp-config\.php|readme\.html|license\.txt)">
  Order allow,deny
  Deny from all
</FilesMatch>
```

### 4. Install Security Plugin

- Wordfence Security (free tier)
- Sucuri Security
- All In One WP Security & Firewall

### 5. Backup Strategy

- Automated daily backups
- Store backups off-site
- Test restore procedure
- Use UpdraftPlus or similar

### 6. Update WordPress

- Enable automatic updates for security releases
- Test major updates on staging first
- Keep plugins updated

## Monitoring

### 1. Uptime Monitoring

Use a service like:
- Pingdom
- Uptime Robot
- Site24x7

### 2. Performance Monitoring

Monitor with:
- Google Analytics
- Google PageSpeed Insights
- GTmetrix
- Pingdom

### 3. Error Tracking

Enable error logging:

Add to `wp-config.php`:
```php
define('WP_DEBUG', false);
define('WP_DEBUG_LOG', true);
define('WP_DEBUG_DISPLAY', false);
```

Check logs at `/wp-content/debug.log`

## Troubleshooting Deployment

### Theme not appearing

- Verify file permissions: `chmod 755` for directories, `644` for files
- Clear WordPress cache
- Disable all plugins temporarily
- Check PHP error logs

### Maps not loading

- Verify API key is correct
- Check API key has Maps API enabled
- Verify referrer restrictions allow your domain
- Check browser console for errors

### Forms not submitting

- Test API endpoint with curl:
```bash
curl -X POST https://api.example.com/leads \
  -H "Content-Type: application/json" \
  -d '{"name":"test"}'
```
- Check server error logs
- Verify CORS headers if cross-domain

### Styles not loading

- Force browser cache clear
- Check CSS file permissions
- Verify paths are correct
- Check for `.htaccess` blocking

### Database connection errors

- Verify database credentials in `wp-config.php`
- Check database user has proper permissions
- Ensure database server is accessible
- Check MySQL/MariaDB is running

## Rollback Procedure

If issues occur after deployment:

1. **Via File Manager:**
   - Upload previous theme version
   - Activate previous theme
   - Verify site functionality

2. **Via Database Backup:**
   - Restore database from backup
   - Replace theme files
   - Test thoroughly

3. **Via WordPress CLI:**
```bash
wp theme activate previous-theme-slug
wp theme delete oneclick-siteforge
```

## Maintenance Schedule

### Weekly
- Check for WordPress updates
- Monitor uptime reports
- Review error logs

### Monthly
- Update plugins and WordPress
- Test backup restoration
- Review performance metrics

### Quarterly
- Security audit
- Performance optimization review
- User feedback review

## Support & Escalation

For deployment issues:

1. Check error logs first
2. Review troubleshooting section above
3. Test on staging environment
4. Contact oneClick support with:
   - Error message
   - Steps to reproduce
   - Environment details (PHP version, WordPress version, etc.)
   - Error logs

## Post-Deployment Testing

### Functionality Tests
- [ ] All blocks render correctly
- [ ] Images load properly
- [ ] Forms submit successfully
- [ ] Maps display correctly
- [ ] Navigation works on mobile
- [ ] All links are functional

### Performance Tests
- [ ] Page load time < 3 seconds
- [ ] Mobile page score > 75
- [ ] Images are optimized
- [ ] CSS/JS are minified

### Security Tests
- [ ] HTTPS enabled
- [ ] Security headers present
- [ ] Forms validate input
- [ ] API endpoints accessible

### Accessibility Tests
- [ ] Keyboard navigation works
- [ ] Screen reader compatible
- [ ] Color contrast sufficient
- [ ] Form labels present

## Success Criteria

Deployment is successful when:

✓ Theme is active and visible
✓ All theme settings are configured
✓ Blocks are registered and functional
✓ APIs are connected and working
✓ Homepage displays correctly
✓ Navigation is functional
✓ Performance is acceptable
✓ Security checks pass
✓ No console errors
✓ Mobile responsive

---

For additional help, refer to README.md or contact the oneClick support team.
