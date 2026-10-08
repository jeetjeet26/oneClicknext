import {
  Activity,
  BarChart3,
  BedDouble,
  Bot,
  Building2,
  FileText,
  Flame,
  Globe,
  LayoutDashboard,
  MessageSquare,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  Users,
  Wand2,
} from "lucide-react";

export const navigationGroups = [
  {
    label: "Workspace",
    items: [
      {
        href: "/dashboard",
        label: "Overview",
        icon: LayoutDashboard,
        description: "Your property at a glance",
      },
      {
        href: "/dashboard/community",
        label: "Property",
        icon: Building2,
        description: "Property information and knowledge",
      },
      {
        href: "/dashboard/floor-plans",
        label: "Floorplans",
        icon: BedDouble,
        description: "Floorplans and availability",
      },
    ],
  },
  {
    label: "Leasing & relationships",
    items: [
      {
        href: "/dashboard/leads",
        label: "TourSpark",
        icon: Users,
        description: "Leads and tours",
      },
      {
        href: "/dashboard/lumaleasing",
        label: "LumaLeasing",
        icon: MessageSquare,
        description: "Conversations and inquiries",
      },
      {
        href: "/dashboard/leadpulse",
        label: "LeadPulse",
        icon: Flame,
        description: "Follow-up and engagement",
      },
      {
        href: "/dashboard/reviewflow",
        label: "ReviewFlow AI",
        icon: Star,
        description: "Reviews and reputation",
      },
    ],
  },
  {
    label: "Marketing & insights",
    items: [
      {
        href: "/dashboard/siteforge",
        label: "SiteForge",
        icon: Globe,
        description: "Website generation and packages",
      },
      {
        href: "/dashboard/forgestudio",
        label: "ForgeStudio AI",
        icon: Wand2,
        description: "Creative and content",
      },
      {
        href: "/dashboard/marketvision",
        label: "MarketVision 360",
        icon: TrendingUp,
        description: "Market intelligence",
      },
      {
        href: "/dashboard/propertyaudit",
        label: "PropertyAudit",
        icon: Search,
        description: "Visibility and website health",
      },
      {
        href: "/dashboard/intelligence",
        label: "Property intelligence",
        icon: Sparkles,
        description: "Reviewed facts, data and results",
      },
      {
        href: "/dashboard/bi",
        label: "MultiChannel BI",
        icon: BarChart3,
        description: "Marketing performance",
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        href: "/dashboard/delivery",
        label: "Client reporting",
        icon: FileText,
        description: "Client reports and leasing outcomes",
      },
      {
        href: "/dashboard/agency",
        label: "Agency review",
        icon: ShieldCheck,
        description: "Review agency work",
      },
      {
        href: "/dashboard/activity",
        label: "Activity history",
        icon: Activity,
        description: "Changes and decisions",
      },
      {
        href: "/dashboard/pipelines",
        label: "Pipelines",
        icon: FileText,
        description: "Data imports and connections",
      },
      {
        href: "/dashboard/luma",
        label: "Luma AI Assistant",
        icon: Bot,
        description: "Your workspace assistant",
      },
      {
        href: "/dashboard/team",
        label: "Team",
        icon: Users,
        description: "Internal team access",
      },
      {
        href: "/dashboard/clients",
        label: "Client access",
        icon: Building2,
        description: "Client logins and assigned properties",
      },
    ],
  },
];
export const settingsNavigation = {
  href: "/dashboard/settings",
  label: "Settings",
  icon: Settings,
  description: "Workspace preferences",
};
export const portalNavigation = [
  { href: "/client", label: "Overview", icon: LayoutDashboard },
  { href: "/client/insights", label: "Insights", icon: Sparkles },
  { href: "/client/performance", label: "Performance", icon: BarChart3 },
  { href: "/client/properties", label: "Properties", icon: Building2 },
  { href: "/client/reports", label: "Reports", icon: FileText },
  {
    href: "/client/conversations",
    label: "Conversations",
    icon: MessageSquare,
  },
];
export function currentSection(path: string) {
  const all = [...navigationGroups.flatMap((g) => g.items), settingsNavigation];
  const match = all
    .filter(
      (i) =>
        path === i.href ||
        (i.href !== "/dashboard" && path.startsWith(i.href + "/")),
    )
    .sort((a, b) => b.href.length - a.href.length)[0];
  return (
    match ?? {
      label: "Workspace",
      description: "Your property workspace",
      icon: Sparkles,
      href: "/dashboard",
    }
  );
}
