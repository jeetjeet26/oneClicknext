// Converts SiteForge blueprint sections to WordPress Gutenberg block format
//
// Blueprint sections already specify their target ACF block via `acfBlock`
// (e.g. "acf/top-slides", "acf/content-grid") and carry two data payloads:
//   - `fields`  – structured ACF field data (repeaters, toggles, layout hints)
//   - `content` – AI-generated copy (headline, subheadline, body, cta, etc.)
//
// The parser merges both into a single ACF data object and wraps it in a
// Gutenberg block comment that WordPress can interpret.

import type { BlueprintSection } from '../_shared/types.ts';

// Content keys that should be promoted into ACF block data when present
const CONTENT_KEYS = [
  'headline',
  'subheadline',
  'content',
  'cta_text',
  'cta_link',
  'cta_style',
] as const;

/**
 * Flatten repeater arrays into ACF's indexed key format.
 *
 * WordPress ACF stores repeater rows as:
 *   fieldname_0_subfield = "value"
 *   fieldname_1_subfield = "value"
 *   fieldname = 2                   (row count)
 *
 * Blueprint JSON stores them as normal arrays:
 *   { fieldname: [{ subfield: "value" }, { subfield: "value" }] }
 *
 * This function detects arrays of objects and converts them.
 */
function flattenRepeaterFields(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
      // This is a repeater field — flatten to indexed keys
      flat[key] = value.length; // row count

      for (let i = 0; i < value.length; i++) {
        const row = value[i] as Record<string, unknown>;
        for (const [subKey, subVal] of Object.entries(row)) {
          flat[`${key}_${i}_${subKey}`] = subVal;
        }
      }
    } else {
      // Scalar, simple array, or null — pass through
      flat[key] = value;
    }
  }

  return flat;
}

/**
 * Merge blueprint `content` and `fields` into a unified ACF data object.
 *
 * Priority:
 *  1. `fields` values win when both sources define the same key
 *  2. Only whitelisted `content` keys are promoted (headline, cta, etc.)
 *  3. Repeater arrays are flattened to ACF indexed format
 */
function buildACFData(section: BlueprintSection): Record<string, unknown> {
  const merged: Record<string, unknown> = {};

  // Pull whitelisted content keys (AI-generated copy)
  if (section.content && typeof section.content === 'object') {
    for (const key of CONTENT_KEYS) {
      if (key in section.content && section.content[key] !== undefined) {
        merged[key] = section.content[key];
      }
    }
  }

  // Overlay structured field data (takes precedence)
  if (section.fields && typeof section.fields === 'object') {
    for (const [key, value] of Object.entries(section.fields)) {
      if (value !== undefined && value !== null) {
        merged[key] = value;
      }
    }
  }

  // Flatten any repeater arrays to ACF indexed format
  return flattenRepeaterFields(merged);
}

/**
 * Convert a single blueprint section to a Gutenberg block comment.
 *
 * Output format:
 *   <!-- wp:acf/block-name {"id":"...","name":"acf/block-name","data":{...},"mode":"preview"} /-->
 */
export function sectionToGutenbergBlock(section: BlueprintSection): string {
  const blockName = section.acfBlock;

  if (!blockName) {
    console.warn(`Section ${section.id} has no acfBlock, falling back to generic paragraph`);
    return createFallbackBlock(section);
  }

  const acfData = buildACFData(section);

  // Stable block ID derived from section ID
  const blockId = `block_${section.id.replace(/-/g, '').substring(0, 12)}`;

  // CSS classes from blueprint
  const cssClasses = Array.isArray(section.cssClasses) && section.cssClasses.length > 0
    ? section.cssClasses
    : undefined;

  const attrs: Record<string, unknown> = {
    id: blockId,
    name: blockName,
    data: acfData,
    mode: 'preview',
  };

  if (cssClasses) {
    attrs.className = cssClasses.join(' ');
  }

  // Strip the "acf/" prefix for the wp: comment tag
  const wpBlockName = blockName.startsWith('acf/')
    ? blockName
    : `acf/${blockName}`;

  const attrStr = JSON.stringify(attrs);
  return `<!-- wp:${wpBlockName} ${attrStr} /-->`;
}

/**
 * Fallback for sections without an acfBlock — renders as paragraphs.
 */
function createFallbackBlock(section: BlueprintSection): string {
  const heading = section.content?.headline ||
    section.content?.heading ||
    section.content?.title ||
    '';
  const body = section.content?.content ||
    section.content?.body ||
    section.content?.description ||
    '';

  const blocks: string[] = [];

  if (heading) {
    blocks.push(
      `<!-- wp:heading -->\n<h2>${escapeHtml(String(heading))}</h2>\n<!-- /wp:heading -->`,
    );
  }

  if (body) {
    blocks.push(
      `<!-- wp:paragraph -->\n<p>${escapeHtml(String(body))}</p>\n<!-- /wp:paragraph -->`,
    );
  }

  return blocks.join('\n');
}

/**
 * Basic HTML entity escaping for fallback blocks.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Convert an entire page's sections to Gutenberg content.
 * Sections are sorted by their `order` field.
 */
export function blueprintToGutenbergContent(sections: BlueprintSection[]): string {
  const sorted = [...sections].sort((a, b) => (a.order || 0) - (b.order || 0));
  return sorted.map((section) => sectionToGutenbergBlock(section)).join('\n\n');
}

/**
 * Create ACF block attributes object (for REST API payloads).
 */
export function createACFBlockAttributes(section: BlueprintSection): Record<string, unknown> {
  if (!section.acfBlock) {
    return {
      headline: section.content?.headline || '',
      content: section.content?.content || '',
    };
  }

  const blockId = `block_${section.id.replace(/-/g, '').substring(0, 12)}`;
  return {
    id: blockId,
    name: section.acfBlock,
    data: buildACFData(section),
    mode: 'preview',
  };
}

/**
 * Return list of ACF block names found across all sections (for validation).
 */
export function getUsedBlockTypes(sections: BlueprintSection[]): string[] {
  const types = new Set<string>();
  for (const section of sections) {
    if (section.acfBlock) {
      types.add(section.acfBlock);
    }
  }
  return Array.from(types);
}
