create or replace function public.bind_siteforge_overlay_identity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_overlay public.siteforge_theme_overlays%rowtype;
  v_overlay_id uuid;
begin
  if new.blueprint ? 'themeOverlayIdentity' then
    v_overlay_id :=
      (new.blueprint->'themeOverlayIdentity'->>'overlayId')::uuid;

    select *
    into v_overlay
    from public.siteforge_theme_overlays
    where id = v_overlay_id
      and website_id = new.website_id
      and org_id = new.org_id
      and property_id = new.property_id;

    if not found then
      raise exception 'SiteForge overlay identity is invalid for this artifact';
    end if;
    if v_overlay.package_sha256 is distinct from
      new.blueprint->'themeOverlayIdentity'->>'packageSha256'
    then
      raise exception 'SiteForge overlay package digest mismatch';
    end if;

    new.theme_overlay_id := v_overlay.id;
    new.overlay_package_sha256 := v_overlay.package_sha256;
  end if;
  return new;
end;
$$;

drop trigger if exists bind_siteforge_overlay_identity
  on public.siteforge_blueprint_versions;
create trigger bind_siteforge_overlay_identity
before insert on public.siteforge_blueprint_versions
for each row execute function public.bind_siteforge_overlay_identity();
