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
        label: "Leads & tours",
        icon: Users,
        description: "TourSpark · Leads and tours",
      },
      {
        href: "/dashboard/lumaleasing",
        label: "Conversations",
        icon: MessageSquare,
        description: "LumaLeasing · Conversations and inquiries",
      },
      {
        href: "/dashboard/leadpulse",
        label: "Follow-up",
        icon: Flame,
        description: "LeadPulse · Follow-up and engagement",
      },
      {
        href: "/dashboard/reviewflow",
        label: "Reviews",
        icon: Star,
        description: "ReviewFlow · Reviews and reputation",
      },
    ],
  },
  {
    label: "Marketing & insights",
    items: [
      {
        href: "/dashboard/siteforge",
        label: "Website",
        icon: Globe,
        description: "SiteForge · Website generation and packages",
      },
      {
        href: "/dashboard/forgestudio",
        label: "Content studio",
        icon: Wand2,
        description: "ForgeStudio · Creative and content",
      },
      {
        href: "/dashboard/marketvision",
        label: "MarketVision",
        icon: TrendingUp,
        description: "Market intelligence",
      },
      {
        href: "/dashboard/propertyaudit",
        label: "Website visibility",
        icon: Search,
        description: "PropertyAudit · Visibility and website health",
      },
      {
        href: "/dashboard/intelligence",
        label: "Performance",
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
        label: "Data connections",
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
