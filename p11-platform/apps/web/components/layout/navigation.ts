import {
  Activity,
  BarChart3,
  BedDouble,
  Bot,
  Building2,
  ClipboardList,
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
        href: "/dashboard/properties/new",
        label: "Onboarding",
        icon: ClipboardList,
        description: "Add a property and complete its setup",
      },
      {
        href: "/dashboard",
        label: "Overview",
        icon: LayoutDashboard,
        description: "Your property at a glance",
      },
      {
        href: "/dashboard/community",
        label: "Community knowledge",
        icon: Building2,
        description: "Property facts, sources, brand and assets",
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
        description: "Performance, market context and measured results",
      },
      {
        href: "/dashboard/portfolio",
        label: "Portfolio assistant",
        icon: Bot,
        description: "Find and compare explicitly selected communities",
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
  { href: "/client", label: "Home", icon: LayoutDashboard },
  { href: "/client/performance", label: "Results", icon: BarChart3 },
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
