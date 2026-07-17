import { Sidebar } from '@/components/layout/Sidebar';
import { PropertySwitcher } from '@/components/layout/PropertySwitcher';
import { PropertyProvider } from '@/components/layout/PropertyContext';
import { PropertySwitchOverlay } from '@/components/layout/PropertySwitchOverlay';
import { UserMenu } from '@/components/layout/UserMenu';
import { GlobalSearch } from '@/components/layout/GlobalSearch';
import { Bell } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  
  const { data: { user }, error } = await supabase.auth.getUser();
  
  if (error || !user) {
    redirect('/auth/login');
  }

  return (
    <PropertyProvider>
      <div className="flex h-screen bg-slate-50">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6">
            <div className="flex items-center gap-4">
              <PropertySwitcher />
              <GlobalSearch />
            </div>
            <div className="flex items-center space-x-3">
              <button className="relative p-2 text-slate-500 hover:bg-slate-100 rounded-full transition-colors">
                <Bell size={20} />
                <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full"></span>
              </button>
              <div className="h-6 w-px bg-slate-200"></div>
              <UserMenu user={user} />
            </div>
          </header>
          <main className="relative flex-1 overflow-auto p-6">
            {children}
            <PropertySwitchOverlay />
          </main>
        </div>
      </div>
    </PropertyProvider>
  );
}
