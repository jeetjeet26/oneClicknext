'use client'

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, MessageSquare, BarChart3, Settings, Building2, Users, Sparkles, Activity, Bot, Flame, TrendingUp, Star, Wand2, Globe, Search, BedDouble } from 'lucide-react';

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
}

function NavLink({ href, label, icon }: NavItem) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
  
  return (
    <Link 
      href={href} 
      className={`flex items-center space-x-2 px-3 py-2 rounded-md transition-colors ${
        isActive 
          ? 'bg-indigo-600 text-white' 
          : 'text-slate-300 hover:bg-slate-800'
      }`}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

export function Sidebar() {
  return (
    <div className="w-64 bg-slate-900 h-screen text-white flex flex-col">
      <div className="p-6 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <span className="text-white font-bold text-sm">P11</span>
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">P11 Console</h1>
            <p className="text-xs text-slate-400">Autonomous Agency</p>
          </div>
        </div>
      </div>
      
      <div className="p-4 flex-1 overflow-y-auto">
        <div className="mb-6">
          <h2 className="text-xs uppercase text-slate-500 font-semibold mb-2 px-3">Platform</h2>
          <nav className="space-y-1">
            <NavLink href="/dashboard" label="Overview" icon={<LayoutDashboard size={18} />} />
            <NavLink href="/dashboard/community" label="Property" icon={<Building2 size={18} />} />
            <NavLink href="/dashboard/floor-plans" label="Floorplans" icon={<BedDouble size={18} />} />
            <NavLink href="/dashboard/team" label="Team" icon={<Users size={18} />} />
          </nav>
        </div>

        <div className="mb-6">
          <h2 className="text-xs uppercase text-slate-500 font-semibold mb-2 px-3">Products</h2>
          <nav className="space-y-1">
            <NavLink href="/dashboard/lumaleasing" label="LumaLeasing" icon={<MessageSquare size={18} />} />
            <NavLink href="/dashboard/leads" label="TourSpark" icon={<Sparkles size={18} />} />
            <NavLink href="/dashboard/leadpulse" label="LeadPulse" icon={<Flame size={18} />} />
            <NavLink href="/dashboard/forgestudio" label="ForgeStudio AI" icon={<Wand2 size={18} />} />
            <NavLink href="/dashboard/siteforge" label="SiteForge" icon={<Globe size={18} />} />
            <NavLink href="/dashboard/marketvision" label="MarketVision 360" icon={<TrendingUp size={18} />} />
            <NavLink href="/dashboard/propertyaudit" label="PropertyAudit" icon={<Search size={18} />} />
            <NavLink href="/dashboard/reviewflow" label="ReviewFlow AI" icon={<Star size={18} />} />
            <NavLink href="/dashboard/bi" label="MultiChannel BI" icon={<BarChart3 size={18} />} />
            <NavLink href="/dashboard/pipelines" label="Pipelines" icon={<Activity size={18} />} />
          </nav>
        </div>

        <div className="mb-6">
          <h2 className="text-xs uppercase text-slate-500 font-semibold mb-2 px-3">AI Tools</h2>
          <nav className="space-y-1">
            <NavLink href="/dashboard/luma" label="Luma AI Assistant" icon={<Bot size={18} />} />
          </nav>
        </div>
      </div>

      <div className="p-4 border-t border-slate-800">
        <NavLink href="/dashboard/settings" label="Settings" icon={<Settings size={18} />} />
      </div>
    </div>
  );
}
