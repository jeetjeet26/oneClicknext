'use client'

import { useState } from 'react'
import {
  X,
  Key,
  Shield,
  CheckCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
  Copy,
  Eye,
  EyeOff,
} from 'lucide-react'

interface PlatformSetupModalProps {
  propertyId: string
  /** OAuth connect route id (linkedin | tiktok | x) */
  platformId: 'linkedin' | 'tiktok' | 'x'
  onClose: () => void
  onConfigured: () => void
}

const PLATFORM_META: Record<
  PlatformSetupModalProps['platformId'],
  {
    name: string
    configPlatform: string
    appIdLabel: string
    appSecretLabel: string
    devPortalUrl: string
    devPortalName: string
    notes: string[]
  }
> = {
  linkedin: {
    name: 'LinkedIn',
    configPlatform: 'linkedin',
    appIdLabel: 'Client ID',
    appSecretLabel: 'Client Secret',
    devPortalUrl: 'https://www.linkedin.com/developers/apps',
    devPortalName: 'LinkedIn Developer Portal',
    notes: [
      'Create an app and request the "Share on LinkedIn" and "Sign In with LinkedIn using OpenID Connect" products.',
      'Add the redirect URL below under Auth → OAuth 2.0 settings.',
    ],
  },
  tiktok: {
    name: 'TikTok',
    configPlatform: 'tiktok',
    appIdLabel: 'Client Key',
    appSecretLabel: 'Client Secret',
    devPortalUrl: 'https://developers.tiktok.com/apps',
    devPortalName: 'TikTok for Developers',
    notes: [
      'Create an app with the Login Kit and Content Posting API products.',
      'Content posts stay private until TikTok approves your app audit.',
      'Add the redirect URL below to the Login Kit settings.',
    ],
  },
  x: {
    name: 'X (Twitter)',
    configPlatform: 'x',
    appIdLabel: 'OAuth 2.0 Client ID',
    appSecretLabel: 'OAuth 2.0 Client Secret',
    devPortalUrl: 'https://developer.x.com/en/portal/dashboard',
    devPortalName: 'X Developer Portal',
    notes: [
      'Enable OAuth 2.0 with type "Web App" and confidential client.',
      'Posting requires a paid API tier (Basic or above).',
      'Add the redirect URL below to the app authentication settings.',
    ],
  },
}

export function PlatformSetupModal({ propertyId, platformId, onClose, onConfigured }: PlatformSetupModalProps) {
  const meta = PLATFORM_META[platformId]
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const redirectUri =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/forgestudio/social/callback/${platformId}`
      : ''

  const handleSave = async () => {
    if (!appId.trim() || !appSecret.trim()) {
      setError(`Please enter both ${meta.appIdLabel} and ${meta.appSecretLabel}`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/forgestudio/social/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          platform: meta.configPlatform,
          appId: appId.trim(),
          appSecret: appSecret.trim(),
          redirectUri,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save credentials')
      }
      setSaved(true)
      onConfigured()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credentials')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-hidden">
        <div className="bg-slate-900 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 text-white">
            <div className="p-2 bg-white/20 rounded-lg">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Connect {meta.name}</h2>
              <p className="text-sm text-white/70">Set up your {meta.name} app credentials</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)] space-y-5">
          {saved ? (
            <div className="text-center space-y-5">
              <div className="w-14 h-14 bg-green-100 dark:bg-green-500/20 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="w-7 h-7 text-green-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                  Credentials Saved
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Now authorize the {meta.name} account you want to publish from.
                </p>
              </div>
              <button
                onClick={() => {
                  window.location.href = `/api/forgestudio/social/connect/${platformId}?propertyId=${propertyId}`
                }}
                className="w-full px-4 py-3 bg-slate-900 text-white font-medium rounded-xl hover:opacity-90"
              >
                Connect {meta.name} Now
              </button>
              <button
                onClick={onClose}
                className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              >
                I&apos;ll connect later
              </button>
            </div>
          ) : (
            <>
              <div className="text-sm text-slate-600 dark:text-slate-400 space-y-2">
                <p>
                  Create an app in the{' '}
                  <a
                    href={meta.devPortalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-violet-600 hover:underline inline-flex items-center gap-1"
                  >
                    {meta.devPortalName} <ExternalLink className="w-3 h-3" />
                  </a>
                  , then paste its credentials here.
                </p>
                <ul className="list-disc list-inside space-y-1">
                  {meta.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  OAuth Redirect URL
                </label>
                <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700 p-2 rounded-lg">
                  <code className="text-xs flex-1 break-all">{redirectUri}</code>
                  <button
                    onClick={() => navigator.clipboard.writeText(redirectUri)}
                    className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-600 rounded"
                    title="Copy"
                  >
                    <Copy className="w-4 h-4 text-slate-500" />
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {meta.appIdLabel}
                </label>
                <input
                  type="text"
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {meta.appSecretLabel}
                </label>
                <div className="relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={appSecret}
                    onChange={(e) => setAppSecret(e.target.value)}
                    className="w-full px-4 py-2.5 pr-12 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  >
                    {showSecret ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                  <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                </div>
              )}

              <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-4 flex items-start gap-3">
                <Shield className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  The secret is encrypted before storage and never exposed to the browser after saving.
                </p>
              </div>

              <button
                onClick={handleSave}
                disabled={saving || !appId.trim() || !appSecret.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white font-medium rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Credentials'
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
