# Adding the LumaLeasing Chat Widget to a WordPress Site

This guide walks you through adding the LumaLeasing AI leasing assistant (the chat bubble) to a property's WordPress website. No coding experience needed for the plugin route; total time is about 15 minutes.

Regardless of the install method, the widget itself lives on our platform: the page loads `lumaleasing.js` from `https://hellop11.com`, renders a chat bubble in the corner of every page, and talks to our API using the property's API key. Widget updates ship automatically from our side — nothing on the WordPress site needs re-installing.

## Before You Start

You need two things:

1. **The property's API key.** Get it from the P11 dashboard: `https://hellop11.com/dashboard/lumaleasing` → **Embed Code** tab. If you don't have dashboard access, ask the P11 team to send it.
2. **Confirmation from the P11 team** that the WordPress site's domain (e.g. `https://www.sunsetridge.com`) has been added to the platform's allowed-origins list, and that the widget config is active. If this isn't done, the widget will show "Chat is temporarily unavailable."

## Option A: Official LumaLeasing Plugin (Recommended)

We have a dedicated WordPress plugin — no code editing at all. Source: [github.com/jeetjeet26/lumawidget](https://github.com/jeetjeet26/lumawidget). Ask the P11 team for the plugin zip (`lumaleasing-wordpress.zip`), or build one by zipping the repo contents into a single folder.

1. In WordPress admin, go to **Plugins → Add New → Upload Plugin**.
2. Choose the zip, click **Install Now**, then **Activate Plugin**.
   (Alternatively, upload the extracted folder to `/wp-content/plugins/` via FTP and activate from the Plugins screen.)
3. Go to **Settings → LumaLeasing** in WordPress admin:
   - **API URL:** `https://hellop11.com` — ignore any docs mentioning `p11platform.vercel.app`; that URL is outdated.
   - **API Key:** the property's key from the P11 dashboard.
   - **Widget Position:** bottom-right (default) or bottom-left.
4. Click **Test Connection** to verify, then **Save Settings**.

The widget loads automatically on all pages. To limit it to specific pages, use the `[lumaleasing]` shortcode plus the `lumaleasing_load_widget` filter (see `docs/DEVELOPER.md` in the plugin repo).

If you can't install plugins on the site, use the manual snippet below instead — it does exactly the same thing.

## Option B: Manual Snippet

Use this exact snippet, replacing `YOUR_API_KEY` with the property's API key:

```html
<!-- LumaLeasing Widget -->
<script>
  window.LUMALEASING_API_BASE = 'https://hellop11.com';
  (function(w,d,s,o,f,js,fjs){
    w['LumaLeasing']=o;w[o]=w[o]||function(){(w[o].q=w[o].q||[]).push(arguments)};
    js=d.createElement(s);fjs=d.getElementsByTagName(s)[0];
    js.id=o;js.src=f;js.async=1;fjs.parentNode.insertBefore(js,fjs);
  }(window,document,'script','lumaleasing','https://hellop11.com/lumaleasing.js'));
  lumaleasing('init', 'YOUR_API_KEY');
</script>
```

> **Important:** The `window.LUMALEASING_API_BASE = 'https://hellop11.com';` line is required on any site that is not hellop11.com itself. Without it, the widget tries to call the API on the WordPress site's own domain and fails silently. If the snippet you copied from the dashboard doesn't include this line, add it as the first line inside the `<script>` tag. (The official plugin sets this automatically.)

### B1: Via a Header/Footer Plugin

This is the safest snippet route — it survives theme updates and doesn't require editing theme files.

1. In WordPress admin, go to **Plugins → Add New Plugin**.
2. Search for **WPCode** (formerly "Insert Headers and Footers"). Install and activate it.
3. Go to **Code Snippets → Header & Footer** (or **WPCode → Header & Footer**).
4. Paste the full snippet into the **Footer** box.
5. Click **Save Changes**.

The widget now loads on every page. If the site already has a similar plugin installed (WPCode, "Insert Headers and Footers", "Header Footer Code Manager", etc.), use that instead of installing a new one.

### B2: Theme's functions.php (Child Theme)

If the site avoids extra plugins and uses a child theme, add this to the child theme's `functions.php`:

```php
add_action( 'wp_footer', function () {
    ?>
    <!-- LumaLeasing Widget -->
    <script>
      window.LUMALEASING_API_BASE = 'https://hellop11.com';
      (function(w,d,s,o,f,js,fjs){
        w['LumaLeasing']=o;w[o]=w[o]||function(){(w[o].q=w[o].q||[]).push(arguments)};
        js=d.createElement(s);fjs=d.getElementsByTagName(s)[0];
        js.id=o;js.src=f;js.async=1;fjs.parentNode.insertBefore(js,fjs);
      }(window,document,'script','lumaleasing','https://hellop11.com/lumaleasing.js'));
      lumaleasing('init', 'YOUR_API_KEY');
    </script>
    <?php
} );
```

Only do this in a **child theme** — edits to a parent theme are wiped by theme updates.

### Specific Pages Only

If the widget should only appear on certain pages (e.g. not on the blog):

- **Official plugin:** use the `lumaleasing_load_widget` filter or the `[lumaleasing]` shortcode.
- **WPCode:** create a new snippet of type "HTML Snippet", set **Location** to "Site Wide Footer", and use the **Conditional Logic** panel to limit it to specific pages/URLs.
- **functions.php:** wrap the output in a conditional, e.g. `if ( is_front_page() || is_page( array( 'floor-plans', 'contact' ) ) ) { ... }`.

## Verify It Works

1. Open the site in a private/incognito window (avoids logged-in admin bars and cached pages).
2. A round chat bubble should appear in the bottom-right corner within a couple of seconds.
3. Click it — the chat window should open with the property's name, logo, brand colors, and welcome message.
4. Send a test question like "Do you allow pets?" and confirm you get a real answer.
5. Optional deeper check: open browser DevTools → **Network** tab, reload, and confirm requests to `hellop11.com/api/lumaleasing/...` return status 200.

## Troubleshooting

| Problem | Likely cause / fix |
|---|---|
| No bubble appears at all | Page caching — clear the site cache (WP Rocket, W3 Total Cache, LiteSpeed, host-level cache) and retry in incognito. If using the plugin, confirm it's activated, "Enable Widget" is on, and both API URL and API key are saved. If using the snippet, check it was saved to the **footer**, not a draft. |
| Bubble appears, but says "Chat is temporarily unavailable" | The site's domain isn't in the platform's allowed-origins list, the API key is wrong, or the widget is deactivated. Contact the P11 team with the exact domain (including `www.` or not). |
| Widget breaks after enabling a performance plugin | JS optimizers (Autoptimize, WP Rocket "Delay JavaScript", SiteGround Optimizer) can defer or mangle the script. Add `lumaleasing` to the plugin's JavaScript **exclusion list**. |
| Bubble shows but clicking does nothing | Check the browser console for errors. A strict Content-Security-Policy on the site must allow `script-src https://hellop11.com` and `connect-src https://hellop11.com`. |
| Widget appears twice | The snippet was added in two places (e.g. both a plugin and the theme). Remove one. |

## Removing the Widget

Deactivate the LumaLeasing plugin, or delete the snippet from wherever you added it (WPCode snippet or `functions.php`), then clear the site cache. The P11 team can also deactivate it platform-side instantly, which makes the bubble disappear even if the plugin/snippet is still on the site.
