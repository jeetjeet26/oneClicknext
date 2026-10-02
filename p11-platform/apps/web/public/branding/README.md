# P11 console brand assets

Reference: https://www.p11.com/, inspected September 30, 2026 at the user's request.

- `components/ui/P11Logo.tsx` uses the original static 68 × 68 outlined P11 logo paths embedded in the homepage. Geometry is unchanged; color inherits the console's neutral ink. The website's animation is omitted.
- `p11-icon.svg` is the published website icon from https://cdn.prod.website-files.com/68dfe6887b4f027ec040a678/69ba90a052fd06585ec565c6_p11-webclip.svg . P11 retains ownership of the logo artwork.
- Primary orange `#fa4616`, black/white and neutral grays come from the published Webflow design tokens. Small links use a darker orange for legibility; bright orange controls use dark text, while compact primary actions use a deeper accessible orange with white text. Status colors retain their meaning.
- `app/fonts/InterTight-Variable.woff2` comes from the site's published Inter Tight family: https://cdn.prod.website-files.com/68dfe6887b4f027ec040a678/690484831e38e9f9f08e91ed_InterTight-VariableFont_wght.woff2 . Its OFL license is included beside it. It is self-hosted using Next's local font loader for console headings. The marketing site's primary Area family uses Adobe Fonts; this app does not copy or depend on that domain-bound font kit. Geist remains the readable body font.

The console keeps a light, understated composition. Brand treatment is scoped to app surfaces, away from generated property website designs. No website scripts, trackers or animation packages are imported.
