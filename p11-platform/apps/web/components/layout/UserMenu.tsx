'use client'

import { User } from '@supabase/supabase-js'
import { signOut } from '@/app/auth/actions'
import { useState, useRef, useEffect } from 'react'
import { User as UserIcon, LogOut, Settings, ChevronDown } from 'lucide-react'
import { useRouter } from 'next/navigation'

type UserMenuProps = {
  user: User
  displayName?: string
}

export function UserMenu({ user,displayName=user.email?.split('@')[0]||'User' }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [signingOut,setSigningOut]=useState(false)
  const [signOutError,setSignOutError]=useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const initials = displayName
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-muted transition-colors"
      >
        <div className="h-8 w-8 bg-primary rounded-full flex items-center justify-center text-primary-foreground text-sm font-medium shadow-sm">
          {initials}
        </div>
        <span className="text-sm font-medium text-foreground hidden sm:block max-w-[120px] truncate">
          {displayName}
        </span>
        <ChevronDown 
          size={16} 
          className={`text-slate-400 transition-transform hidden sm:block ${isOpen ? 'rotate-180' : ''}`} 
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-card rounded-xl shadow-lg border border-border py-1 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-sm font-medium text-card-foreground truncate">{displayName}</p>
            <p className="text-xs text-slate-500 truncate">{user.email}</p>
          </div>
          
          <div className="py-1">
            <button
              onClick={() => {
                setIsOpen(false)
                router.push('/dashboard/profile')
              }}
              className="w-full px-4 py-2 text-left text-sm text-foreground hover:bg-muted flex items-center gap-3 transition-colors"
            >
              <UserIcon size={16} className="text-slate-400" />
              Profile
            </button>
            <button
              onClick={() => {
                setIsOpen(false)
                router.push('/dashboard/settings')
              }}
              className="w-full px-4 py-2 text-left text-sm text-foreground hover:bg-muted flex items-center gap-3 transition-colors"
            >
              <Settings size={16} className="text-slate-400" />
              Settings
            </button>
          </div>

          <div className="border-t border-border py-1">
            <div>
              <button
                type="button"
                disabled={signingOut}
                onClick={()=>{setSigningOut(true);setSignOutError('');void signOut().catch(()=>{setSignOutError('Sign-out could not be confirmed. Open account security to check its saved request.');setSigningOut(false)})}}
                className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors"
              >
                <LogOut size={16} />
                {signingOut?'Signing out…':'Sign out'}
              </button>
            {signOutError&&<div role="alert" className="px-4 py-2 text-sm"><p>{signOutError}</p><button className="mt-2 underline" onClick={()=>router.push('/account/security')}>Open account security</button></div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

