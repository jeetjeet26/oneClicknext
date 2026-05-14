'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { usePropertyContext } from '@/components/layout/PropertyContext'
import { 
  Database, ArrowLeft, CheckCircle2, AlertCircle, RefreshCw, 
  Zap, ChevronRight, Settings, Loader2, Shield
} from 'lucide-react'

interface FieldMapping {
  tourspark_field: string
  crm_field: string
  confidence: number
  reasoning: string
  alternatives: string[]
}

interface CRMSchema {
  crm_type: string
  api_version: string
  objects: Array<{
    name: string
    label: string
    fields: Array<{
      name: string
      label: string
      type: string
      required: boolean
    }>
  }>
}

const CRM_TYPES = [
  { id: 'yardi', name: 'Yardi', description: 'RENTCafé & Voyager' },
  { id: 'realpage', name: 'RealPage', description: 'OneSite & Active Building' },
  { id: 'salesforce', name: 'Salesforce', description: 'Sales Cloud' },
  { id: 'hubspot', name: 'HubSpot', description: 'CRM' },
  { id: 'lasso', name: 'Lasso', description: 'New home sales CRM' },
]

const CRM_PLATFORMS = CRM_TYPES.map((crm) => crm.id)

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  )
}

async function readCRMResponse(response: Response) {
  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json')
    ? await response.json()
    : { error: await response.text() }

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : `CRM request failed (${response.status})`
    throw new Error(message)
  }

  return payload
}

export default function CRMSettingsPage() {
  const router = useRouter()
  const supabase = createClient()
  const { currentProperty } = usePropertyContext()

  const [selectedProperty, setSelectedProperty] = useState<string>('')
  const [selectedCRM, setSelectedCRM] = useState<string>('')
  const [credentials, setCredentials] = useState({
    api_endpoint: '',
    api_key: '',
    property_code: '',
    project_id: '',
  })

  const [step, setStep] = useState<'select' | 'credentials' | 'discovery' | 'mapping' | 'validation'>('select')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [credentialResult, setCredentialResult] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)
  const credentialResultRef = useRef<HTMLDivElement | null>(null)

  const [schema, setSchema] = useState<CRMSchema | null>(null)
  const [mappings, setMappings] = useState<FieldMapping[]>([])
  const [editedMappings, setEditedMappings] = useState<Record<string, string>>({})
  const [agentReasoning, setAgentReasoning] = useState('')
  const [validationResult, setValidationResult] = useState<{ valid: boolean; errors: string[] } | null>(null)

  // Auto-select current property from context
  useEffect(() => {
    if (currentProperty?.id) {
      setSelectedProperty(currentProperty.id)
    }
  }, [currentProperty])

  // Check existing integration
  const checkExistingIntegration = useCallback(async () => {
    if (!selectedProperty) return

    const { data } = await supabase
      .from('integration_credentials')
      .select('*')
      .eq('property_id', selectedProperty)
      .in('platform', CRM_PLATFORMS)
      .single()

    if (data) {
      const savedCredentials = isStringRecord(data.credentials) ? data.credentials : {}
      const savedFieldMapping = isStringRecord(data.field_mapping) ? data.field_mapping : {}

      setSelectedCRM(data.platform)
      setCredentials({
        api_endpoint: '',
        api_key: '',
        property_code: '',
        project_id: '',
        ...savedCredentials,
      })
      setEditedMappings(savedFieldMapping)
      
      if (data.mapping_validated) {
        setStep('validation')
      } else if (Object.keys(savedFieldMapping).length > 0) {
        setStep('mapping')
      } else {
        setStep('credentials')
      }
    }
  }, [selectedProperty, supabase])

  const selectedCRMConfig = CRM_TYPES.find((crm) => crm.id === selectedCRM)
  const isLasso = selectedCRM === 'lasso'
  const credentialsReady = Boolean(
    credentials.api_key && (isLasso || credentials.api_endpoint)
  )

  useEffect(() => {
    if (credentialResult) {
      credentialResultRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }
  }, [credentialResult])

  useEffect(() => {
    if (selectedProperty) {
      checkExistingIntegration()
    }
  }, [selectedProperty, checkExistingIntegration])

  const testConnection = async () => {
    setLoading(true)
    setError(null)
    setSuccess(null)
    setCredentialResult(null)

    try {
      const response = await fetch('/api/integrations/crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test-connection',
          propertyId: selectedProperty,
          crmType: selectedCRM,
          credentials,
        }),
      })

      const data = await readCRMResponse(response)

      if (data.success) {
        const message = data.message || 'Connection successful! Continue to schema discovery.'
        setSuccess(message)
        setCredentialResult({ type: 'success', message })
        setStep('discovery')
      } else {
        const message = data.error || data.message || 'Connection failed'
        setError(message)
        setCredentialResult({ type: 'error', message })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to test connection'
      setError(message)
      setCredentialResult({ type: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  const discoverSchema = async () => {
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/integrations/crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'discover-schema',
          propertyId: selectedProperty,
          crmType: selectedCRM,
          credentials,
        }),
      })

      const data = await readCRMResponse(response)

      if (data.success !== false) {
        setSchema(data.schema)
        setMappings(data.mappings || [])
        setAgentReasoning(data.agent_reasoning || '')
        
        // Initialize edited mappings from AI suggestions
        const initial: Record<string, string> = {}
        data.mappings?.forEach((m: FieldMapping) => {
          initial[m.tourspark_field] = m.crm_field
        })
        setEditedMappings(initial)
        
        setStep('mapping')
      } else {
        setError(data.error || 'Schema discovery failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to discover schema')
    } finally {
      setLoading(false)
    }
  }

  const validateMapping = async () => {
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/integrations/crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'validate-mapping',
          propertyId: selectedProperty,
          crmType: selectedCRM,
          credentials,
          fieldMapping: editedMappings,
        }),
      })

      const data = await readCRMResponse(response)

      setValidationResult({
        valid: data.valid || false,
        errors: data.errors || [],
      })

      if (data.valid) {
        // Save validated mapping
        const saveResponse = await fetch('/api/integrations/crm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save-mapping',
            propertyId: selectedProperty,
            crmType: selectedCRM,
            credentials,
            fieldMapping: editedMappings,
            validated: true,
          }),
        })
        await readCRMResponse(saveResponse)

        setSuccess('Mapping validated and saved!')
        setStep('validation')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed')
    } finally {
      setLoading(false)
    }
  }

  const saveMappingWithoutValidation = async () => {
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/integrations/crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save-mapping',
          propertyId: selectedProperty,
          crmType: selectedCRM,
          credentials,
          fieldMapping: editedMappings,
          validated: false,
        }),
      })
      await readCRMResponse(response)

      setSuccess('Mapping saved (not validated)')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save mapping')
    } finally {
      setLoading(false)
    }
  }

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 90) return 'text-emerald-400'
    if (confidence >= 70) return 'text-amber-400'
    return 'text-red-400'
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => router.back()}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <Database className="w-8 h-8 text-teal-400" />
              CRM Integration Setup
            </h1>
            <p className="text-slate-400">Connect your CRM to automatically sync leads</p>
          </div>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-3">
            <AlertCircle className="text-red-400 flex-shrink-0" size={20} />
            <p className="text-red-300">{error}</p>
          </div>
        )}
        {success && (
          <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-3">
            <CheckCircle2 className="text-emerald-400 flex-shrink-0" size={20} />
            <p className="text-emerald-300">{success}</p>
          </div>
        )}

        {/* Step 1: Select Property & CRM */}
        <div className="bg-slate-800/50 rounded-2xl border border-slate-700 p-6 mb-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <span className="w-8 h-8 bg-teal-500/20 text-teal-400 rounded-lg flex items-center justify-center text-sm font-bold">1</span>
            Select CRM Platform
          </h2>

          {/* Show current property */}
          {currentProperty && (
            <div className="mb-4 p-3 bg-teal-500/10 border border-teal-500/30 rounded-lg">
              <p className="text-sm text-teal-300">
                <strong>Property:</strong> {currentProperty.name}
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4">

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">CRM Platform</label>
              <select
                value={selectedCRM}
                onChange={(e) => {
                  setSelectedCRM(e.target.value)
                  setCredentialResult(null)
                  if (step !== 'select') setStep('credentials')
                }}
                className="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                disabled={!currentProperty}
              >
                <option value="">Select CRM...</option>
                {CRM_TYPES.map((crm) => (
                  <option key={crm.id} value={crm.id}>{crm.name} - {crm.description}</option>
                ))}
              </select>
            </div>
          </div>

          {currentProperty && selectedCRM && step === 'select' && (
            <button
              onClick={() => setStep('credentials')}
              className="mt-4 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-500 transition-colors flex items-center gap-2"
            >
              Continue
              <ChevronRight size={18} />
            </button>
          )}
        </div>

        {/* Step 2: Credentials */}
        {step !== 'select' && selectedCRM && (
          <div className="bg-slate-800/50 rounded-2xl border border-slate-700 p-6 mb-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <span className="w-8 h-8 bg-teal-500/20 text-teal-400 rounded-lg flex items-center justify-center text-sm font-bold">2</span>
              API Credentials
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  API Endpoint{isLasso ? ' (Optional)' : ''}
                </label>
                <input
                  type="url"
                  value={credentials.api_endpoint}
                  onChange={(e) => setCredentials({ ...credentials, api_endpoint: e.target.value })}
                  placeholder={isLasso ? 'https://api.lassocrm.com/v1' : 'https://api.rentcafe.com/v1'}
                  className="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">API Key / Token</label>
                <input
                  type="password"
                  value={credentials.api_key}
                  onChange={(e) => setCredentials({ ...credentials, api_key: e.target.value })}
                  placeholder="Your API key"
                  className="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  {isLasso ? 'Project / Community ID (Optional)' : 'Property Code (Yardi/RealPage)'}
                </label>
                <input
                  type="text"
                  value={isLasso ? credentials.project_id : credentials.property_code}
                  onChange={(e) => setCredentials({
                    ...credentials,
                    [isLasso ? 'project_id' : 'property_code']: e.target.value,
                  })}
                  placeholder={isLasso ? 'e.g., lasso project id' : 'e.g., PROP001'}
                  className="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                />
              </div>

              <button
                onClick={testConnection}
                disabled={loading || !credentialsReady}
                className="px-4 py-2.5 bg-teal-600 text-white rounded-lg hover:bg-teal-500 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <Zap size={18} />}
                {loading ? 'Testing Connection...' : 'Test Connection'}
              </button>

              {credentialResult && (
                <div
                  ref={credentialResultRef}
                  className={`p-4 rounded-xl border flex items-start gap-3 ${
                    credentialResult.type === 'success'
                      ? 'bg-emerald-500/10 border-emerald-500/30'
                      : 'bg-red-500/10 border-red-500/30'
                  }`}
                >
                  {credentialResult.type === 'success' ? (
                    <CheckCircle2 className="text-emerald-400 flex-shrink-0 mt-0.5" size={20} />
                  ) : (
                    <AlertCircle className="text-red-400 flex-shrink-0 mt-0.5" size={20} />
                  )}
                  <div>
                    <p
                      className={`font-medium ${
                        credentialResult.type === 'success' ? 'text-emerald-300' : 'text-red-300'
                      }`}
                    >
                      {credentialResult.type === 'success'
                        ? 'Connection test succeeded'
                        : 'Connection test failed'}
                    </p>
                    <p className="text-sm text-slate-300 mt-1">{credentialResult.message}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 3: AI Schema Discovery */}
        {step === 'discovery' && (
          <div className="bg-slate-800/50 rounded-2xl border border-slate-700 p-6 mb-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <span className="w-8 h-8 bg-teal-500/20 text-teal-400 rounded-lg flex items-center justify-center text-sm font-bold">3</span>
              AI Schema Discovery
            </h2>

            <p className="text-slate-400 mb-4">
              Claude will analyze your CRM schema and suggest intelligent field mappings.
            </p>

            <button
              onClick={discoverSchema}
              disabled={loading}
              className="px-4 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-lg hover:from-violet-500 hover:to-purple-500 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  Analyzing Schema...
                </>
              ) : (
                <>
                  <Zap size={18} />
                  Discover & Map Fields
                </>
              )}
            </button>
          </div>
        )}

        {/* Step 4: Field Mapping Review */}
        {(step === 'mapping' || step === 'validation') && (
          <div className="bg-slate-800/50 rounded-2xl border border-slate-700 p-6 mb-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <span className="w-8 h-8 bg-teal-500/20 text-teal-400 rounded-lg flex items-center justify-center text-sm font-bold">4</span>
              Field Mapping Review
            </h2>

            {agentReasoning && (
              <div className="bg-violet-500/10 border border-violet-500/30 rounded-lg p-4 mb-4">
                <p className="text-sm text-violet-300">
                  <strong>AI Reasoning:</strong> {agentReasoning}
                </p>
              </div>
            )}

            <div className="space-y-3">
              {mappings.map((mapping) => (
                <div key={mapping.tourspark_field} className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-white">{mapping.tourspark_field}</span>
                    <span className={`text-sm font-semibold ${getConfidenceColor(mapping.confidence)}`}>
                      {mapping.confidence}% confidence
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <select
                      value={editedMappings[mapping.tourspark_field] || mapping.crm_field}
                      onChange={(e) => setEditedMappings({
                        ...editedMappings,
                        [mapping.tourspark_field]: e.target.value
                      })}
                      className="flex-1 px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                    >
                      <option value={mapping.crm_field}>{mapping.crm_field}</option>
                      {mapping.alternatives.map((alt) => (
                        <option key={alt} value={alt}>{alt}</option>
                      ))}
                      {schema?.objects[0]?.fields
                        .filter(f => f.name !== mapping.crm_field && !mapping.alternatives.includes(f.name))
                        .map((f) => (
                          <option key={f.name} value={f.name}>{f.name} ({f.label})</option>
                        ))
                      }
                    </select>
                  </div>
                  
                  <p className="text-xs text-slate-500 mt-2">{mapping.reasoning}</p>
                </div>
              ))}
            </div>

            {/* Validation Result */}
            {validationResult && (
              <div className={`mt-4 p-4 rounded-lg border ${
                validationResult.valid 
                  ? 'bg-emerald-500/10 border-emerald-500/30' 
                  : 'bg-red-500/10 border-red-500/30'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  {validationResult.valid ? (
                    <CheckCircle2 className="text-emerald-400" size={20} />
                  ) : (
                    <AlertCircle className="text-red-400" size={20} />
                  )}
                  <span className={validationResult.valid ? 'text-emerald-300' : 'text-red-300'}>
                    {validationResult.valid ? 'Validation Passed' : 'Validation Failed'}
                  </span>
                </div>
                {validationResult.errors.length > 0 && (
                  <ul className="list-disc list-inside text-sm text-red-300">
                    {validationResult.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex gap-3 mt-6">
              {!validationResult?.valid ? (
                <>
                  <button
                    onClick={validateMapping}
                    disabled={loading}
                    className="px-4 py-2.5 bg-teal-600 text-white rounded-lg hover:bg-teal-500 transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="animate-spin" size={18} /> : <Shield size={18} />}
                    Validate with Test Sync
                  </button>
                  <button
                    onClick={saveMappingWithoutValidation}
                    disabled={loading}
                    className="px-4 py-2.5 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    <Settings size={18} />
                    Skip Validation & Save
                  </button>
                </>
              ) : (
                <button
                  onClick={async () => {
                    setLoading(true)
                    setError(null)
                    setSuccess(null)
                    try {
                      const response = await fetch('/api/integrations/crm', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          action: 'save-mapping',
                          propertyId: selectedProperty,
                          crmType: selectedCRM,
                          credentials,
                          fieldMapping: editedMappings,
                          validated: true,
                        }),
                      })
                      await readCRMResponse(response)
                      setSuccess('Integration saved and activated!')
                      setStep('validation')
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Failed to save')
                    } finally {
                      setLoading(false)
                    }
                  }}
                  disabled={loading}
                  className="px-6 py-3 bg-gradient-to-r from-teal-600 to-emerald-600 text-white font-semibold rounded-lg hover:from-teal-500 hover:to-emerald-500 transition-all shadow-lg flex items-center gap-2 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
                  Save & Activate Integration
                </button>
              )}
            </div>
          </div>
        )}

        {/* Success State */}
        {step === 'validation' && validationResult?.valid && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-6 text-center">
            <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">CRM Integration Active!</h3>
            <p className="text-slate-400 mb-4">
              New leads from the LumaLeasing chatbot will automatically sync to your{' '}
              {selectedCRMConfig?.name} account.
            </p>
            <button
              onClick={() => router.push('/dashboard/settings')}
              className="px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-500 transition-colors"
            >
              Back to Settings
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

