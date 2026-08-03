-- Legacy SiteForge generations predate immutable release snapshot columns.
-- Bind only currently active, asset-free legacy artifacts to the exact base
-- theme package shipped with this release so canonical preview can certify
-- them without rewriting historical versions or claiming missing asset bytes.
update public.siteforge_blueprint_versions as artifact
set asset_manifest = '[]'::jsonb,
    asset_manifest_hash = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    base_theme_package_id = 'oneclick-siteforge@1.0.0',
    base_theme_package_sha256 = 'ceb47b4e9065cb80a4ff73cc428a5f0aa6d0e42f48173405da6b6cf01ea63ffc'
from public.property_websites as website
where website.current_artifact_version_id = artifact.id
  and artifact.asset_manifest = '[]'::jsonb
  and artifact.asset_manifest_hash is null
  and artifact.base_theme_package_sha256 is null
  and artifact.theme_overlay_id is null;
