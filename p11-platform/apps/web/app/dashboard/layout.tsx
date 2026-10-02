import {AccountPreferences} from '@/components/layout/AccountPreferences';
import {appearanceValues} from '@/utils/account-settings/contracts';
import { PropertyBoundary } from '@/components/layout/PropertyBoundary';
import {ActivityRecorder} from '@/components/layout/ActivityRecorder';
import { Sidebar } from '@/components/layout/Sidebar';
import { PropertySwitcher } from '@/components/layout/PropertySwitcher';
import { PropertyProvider } from '@/components/layout/PropertyContext';
import { PropertySwitchOverlay } from '@/components/layout/PropertySwitchOverlay';
import { UserMenu } from '@/components/layout/UserMenu';
import { GlobalSearch } from '@/components/layout/GlobalSearch';
import { Bell } from 'lucide-react';
import {WorkspaceHeading} from '@/components/layout/WorkspaceHeading';
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

  const identity=await supabase.rpc('client_portal_identity');
  if(identity.error)throw new Error('Your account access could not be loaded. Please try again.');
  if(identity.data&&typeof identity.data==='object'&&!Array.isArray(identity.data)&&identity.data.kind==='client')redirect('/client');

  const {data:profile,error:profileError}=await supabase.from('profiles').select('org_id,full_name,preferences').eq('id',user.id).single();
  const {data:organization}=profile?.org_id?await supabase.from('organizations').select('settings').eq('id',profile.org_id).single():{data:null};
  const preferences=profile?.preferences&&typeof profile.preferences==='object'&&!Array.isArray(profile.preferences)?profile.preferences:{};
  const settings=organization?.settings&&typeof organization.settings==='object'&&!Array.isArray(organization.settings)?organization.settings:{};
  let historyTimeZone='UTC';
  if(typeof settings.timezone==='string'){try{new Intl.DateTimeFormat('en',{timeZone:settings.timezone});historyTimeZone=settings.timezone}catch{}}
  const appearance=profileError||!profile?null:appearanceValues({theme:preferences.theme,accentColor:preferences.accent_color});
  return (
    <AccountPreferences actorId={user.id} appearance={appearance} timeZone={historyTimeZone}>
    <PropertyProvider>
      <div className="console-shell flex h-dvh flex-col lg:flex-row">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:p-3">Skip to content</a>
        <Sidebar />
        <div className="min-h-0 min-w-0 flex-1 flex flex-col overflow-hidden">
          <header className="console-header">
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
              <WorkspaceHeading />
              <div className="ml-auto flex min-w-0 items-center gap-3"><GlobalSearch /><PropertySwitcher /></div>
            </div>
            <div className="flex shrink-0 items-center space-x-1 sm:space-x-3">
              <button aria-label="Notifications" className="hidden sm:block relative p-2 text-muted-foreground hover:bg-muted rounded-full transition-colors">
                <Bell size={20} />
              </button>
              <div className="hidden sm:block h-6 w-px bg-border"></div>
              <UserMenu user={user} displayName={profile?.full_name||user.email?.split('@')[0]||'User'} />
            </div>
          </header>
          <ActivityRecorder actorId={user.id}/>
          <main id="main-content" className="console-main relative min-h-0 min-w-0 flex-1 overflow-auto">
            <PropertyBoundary>{children}</PropertyBoundary>
            <PropertySwitchOverlay />
          </main>
        </div>
      </div>
    </PropertyProvider>
    </AccountPreferences>
  );
}
