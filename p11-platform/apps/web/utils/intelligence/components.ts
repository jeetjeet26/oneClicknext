export type ComponentGuide = {
  id: string;
  version: string;
  label: string;
  assetClasses: string[];
  requiredFields: string[];
  optionalFields: string[];
  maxHeading: number;
  responsive: string;
  accessibility: string[];
  events: string[];
  conversionIntent: string;
  incompatibleWith: string[];
  brandTokens: string[];
};
const base = {
  version: "1.0.0",
  assetClasses: [
    "multifamily",
    "single_family",
    "master_planned",
    "senior_living",
    "commercial",
  ],
  maxHeading: 100,
  responsive:
    "One column on narrow screens; preserve reading order and 44px targets.",
  accessibility: [
    "Semantic headings",
    "Keyboard operation",
    "Visible focus",
    "Reduced motion",
  ],
  brandTokens: ["color", "typography", "spacing", "radius"],
  incompatibleWith: [],
};
export const componentGuides: ComponentGuide[] = [
  {
    ...base,
    id: "p11.hero",
    label: "Property introduction",
    requiredFields: ["property.name"],
    optionalFields: ["short_description", "primary_cta", "assets"],
    events: ["hero_cta_click"],
    conversionIntent: "Primary property action",
  },
  {
    ...base,
    id: "p11.floorplans",
    label: "Floorplan explorer",
    requiredFields: ["floorplans"],
    optionalFields: ["pricing", "availability", "application_url"],
    events: ["floorplan_view", "floorplan_filter", "tour_start"],
    conversionIntent: "Explore a plan and inquire",
  },
  {
    ...base,
    id: "p11.amenities",
    label: "Amenities and features",
    requiredFields: ["property.amenities"],
    optionalFields: ["amenities_detail", "assets"],
    events: ["amenity_view"],
    conversionIntent: "Evaluate the property",
  },
  {
    ...base,
    id: "p11.location",
    label: "Neighborhood and access",
    requiredFields: ["property.address"],
    optionalFields: ["neighborhood", "location_story", "transit"],
    events: ["location_view"],
    conversionIntent: "Evaluate location",
  },
  {
    ...base,
    id: "p11.gallery",
    label: "Property gallery",
    requiredFields: ["assets"],
    optionalFields: ["creative.imagery"],
    events: ["gallery_open"],
    conversionIntent: "Explore approved imagery",
  },
  {
    ...base,
    id: "p11.faq",
    label: "Questions and answers",
    requiredFields: ["faqs"],
    optionalFields: [],
    events: ["faq_open"],
    conversionIntent: "Resolve questions",
  },
  {
    ...base,
    id: "p11.conversion",
    label: "Tour or application action",
    requiredFields: ["primary_cta"],
    optionalFields: [
      "tour_url",
      "application_url",
      "public_phone",
      "public_email",
    ],
    events: ["tour_start", "application_start", "contact_click"],
    conversionIntent: "Only connect verified destinations",
  },
];
export const publishingTargets = [
  {
    id: "wordpress",
    name: "WordPress",
    status: "Package available",
    detail:
      "Installable theme with editable content. Review and install in your hosting account.",
  },
  {
    id: "standalone",
    name: "Standalone",
    status: "Package available",
    detail:
      "Downloadable website source and assets for your hosting environment.",
  },
  {
    id: "webflow",
    name: "Webflow",
    status: "Content handoff only",
    detail:
      "Webflow does not accept an arbitrary generated website as a native Designer project. Export approved content and field mappings, then assemble the design in Webflow. Automatic publishing is unavailable.",
  },
] as const;
export function webflowCsv(
  facts: Array<{
    field: string;
    value: string;
  }>,
) {
  const cell = (v: string) =>
    '"' + v.replace(/^[=+@-]/, "'$&").replaceAll('"', '""') + '"';
  return [
    ["Name", "Slug", "Approved content"],
    ...facts.map((f) => [
      f.field.replaceAll("_", " "),
      f.field.replaceAll("_", "-"),
      f.value,
    ]),
  ]
    .map((r) => r.map(cell).join(","))
    .join("\r\n");
}
