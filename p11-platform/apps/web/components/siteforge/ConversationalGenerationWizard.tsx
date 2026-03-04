'use client'

// SiteForge Conversational Generation Wizard
// Multi-phase wizard similar to BrandForge conversational flow
// Phase 1: Pre-analysis (Brand Agent findings)
// Phase 2: Conversation (Plan with user input)
// Phase 3: Confirmation (Review and approve)
// Phase 4: Generation (Progress tracking)
// Created: December 16, 2025

import { useState, useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useRouter } from 'next/navigation'

interface ConversationalGenerationWizardProps {
  propertyId: string
  propertyName: string
  open: boolean
  onClose: () => void
}

type Phase = 'analyzing' | 'conversation' | 'confirmation' | 'generating' | 'complete'

interface BrandAnalysis {
  brandContext: any
  stats: {
    photos: number
    documents: number
    hasBrandForge: boolean
  }
}

interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export function ConversationalGenerationWizard({
  propertyId,
  propertyName,
  open,
  onClose
}: ConversationalGenerationWizardProps) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('analyzing')
  const [analysis, setAnalysis] = useState<BrandAnalysis | null>(null)
  const [conversation, setConversation] = useState<ConversationMessage[]>([])
  const [userInput, setUserInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [generationProgress, setGenerationProgress] = useState(0)
  const [generationStep, setGenerationStep] = useState('')
  const [websiteId, setWebsiteId] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  
  // Phase 1: Run pre-analysis when dialog opens
  useEffect(() => {
    if (open && phase === 'analyzing') {
      runPreAnalysis()
    }
  }, [open])
  
  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation])
  
  // Poll generation status
  useEffect(() => {
    if (phase === 'generating' && websiteId) {
      const interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/siteforge/status/${websiteId}`)
          const data = await res.json()
          
          setGenerationProgress(data.progress || 0)
          setGenerationStep(data.currentStep || '')
          
          if (data.status === 'ready_for_preview' || data.status === 'complete') {
            setPhase('complete')
            clearInterval(interval)
            setTimeout(() => {
              router.push(`/dashboard/siteforge/${websiteId}`)
            }, 2000)
          } else if (data.status === 'failed') {
            clearInterval(interval)
            alert('Generation failed: ' + data.errorMessage)
          }
        } catch (err) {
          console.error('Status poll error:', err)
        }
      }, 2000)
      
      return () => clearInterval(interval)
    }
  }, [phase, websiteId])
  
  async function runPreAnalysis() {
    setLoading(true)
    try {
      const res = await fetch(`/api/siteforge/analyze?propertyId=${propertyId}`)
      
      if (!res.ok) {
        throw new Error(`Analysis failed: ${res.status}`)
      }
      
      const data = await res.json()
      
      if (!data.brandContext) {
        throw new Error('No brand context returned from analysis')
      }
      
      setAnalysis(data)
      setPhase('conversation')
      
      // Start conversation with initial AI message
      await startConversation(data.brandContext)
      
    } catch (error) {
      console.error('Pre-analysis error:', error)
      alert(`Failed to analyze brand: ${error instanceof Error ? error.message : 'Unknown error'}`)
      onClose()
    } finally {
      setLoading(false)
    }
  }
  
  async function startConversation(brandContext: any) {
    setLoading(true)
    try {
      const res = await fetch('/api/siteforge/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          brandContext,
          conversationHistory: [],
          userMessage: null
        })
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `Planning failed: ${res.status}`)
      }

      const data = await res.json()

      setConversation([{
        role: 'assistant',
        content: data.aiResponse,
        timestamp: new Date().toISOString()
      }])
      
    } catch (error) {
      console.error('Start conversation error:', error)
    } finally {
      setLoading(false)
    }
  }
  
  async function sendMessage() {
    if (!userInput.trim()) return
    
    // Add user message
    const userMsg: ConversationMessage = {
      role: 'user',
      content: userInput,
      timestamp: new Date().toISOString()
    }
    setConversation(prev => [...prev, userMsg])
    setUserInput('')
    setLoading(true)
    
    try {
      const res = await fetch('/api/siteforge/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          brandContext: analysis?.brandContext,
          conversationHistory: conversation,
          userMessage: userInput
        })
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `Chat failed: ${res.status}`)
      }

      const data = await res.json()

      // Add AI response
      setConversation(prev => [...prev, {
        role: 'assistant',
        content: data.aiResponse,
        timestamp: new Date().toISOString()
      }])

      // Check if ready to generate
      if (data.readyToGenerate) {
        // Move to confirmation immediately
        setTimeout(() => {
          setPhase('confirmation')
        }, 500)
      }

    } catch (error) {
      console.error('Send message error:', error)
      // Show error in chat so user knows something went wrong
      setConversation(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ Something went wrong: ${error instanceof Error ? error.message : 'Failed to send message'}. Please try again.`,
        timestamp: new Date().toISOString()
      }])
    } finally {
      setLoading(false)
    }
  }
  
  async function startGeneration() {
    setPhase('generating')
    setLoading(true)
    
    try {
      // Extract preferences from conversation
      const preferences = extractPreferencesFromConversation(conversation)
      
      const res = await fetch('/api/siteforge/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          preferences,
          prompt: conversation.map(m => `${m.role}: ${m.content}`).join('\n\n'),
          // Pass the pre-analyzed brand context to avoid re-running Brand Agent
          brandContext: analysis?.brandContext
        })
      })
      
      const data = await res.json()
      setWebsiteId(data.websiteId)
      
    } catch (error) {
      console.error('Generation start error:', error)
      alert('Failed to start generation')
      setPhase('conversation')
    } finally {
      setLoading(false)
    }
  }
  
  function extractPreferencesFromConversation(conv: ConversationMessage[]) {
    const text = conv.map(m => m.content).join(' ').toLowerCase()
    
    // Extract style preference
    let style: string | undefined
    if (text.includes('luxury') || text.includes('sophisticated')) style = 'luxury'
    else if (text.includes('modern')) style = 'modern'
    else if (text.includes('cozy') || text.includes('warm')) style = 'cozy'
    else if (text.includes('vibrant') || text.includes('energetic')) style = 'vibrant'
    
    // Extract emphasis
    let emphasis: string | undefined
    if (text.includes('amenity') || text.includes('amenities')) emphasis = 'amenities'
    else if (text.includes('location') || text.includes('neighborhood')) emphasis = 'location'
    else if (text.includes('lifestyle')) emphasis = 'lifestyle'
    else if (text.includes('value') || text.includes('price')) emphasis = 'value'
    
    return { style, emphasis }
  }
  
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>🎨</span>
            {phase === 'analyzing' && 'Analyzing Brand Intelligence...'}
            {phase === 'conversation' && `Planning Website for ${propertyName}`}
            {phase === 'confirmation' && 'Review Your Plan'}
            {phase === 'generating' && 'Generating Website...'}
            {phase === 'complete' && '✅ Website Ready!'}
          </DialogTitle>
        </DialogHeader>
        
        {/* Phase 1: Analyzing */}
        {phase === 'analyzing' && (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <div className="animate-spin text-4xl">🔍</div>
            <p className="text-lg font-medium">Analyzing brand intelligence...</p>
            <p className="text-sm text-gray-500">
              Reading BrandForge data, vector embeddings, and knowledge base
            </p>
          </div>
        )}
        
        {/* Phase 2: Conversation */}
        {phase === 'conversation' && analysis && (
          <div className="flex flex-col flex-1 min-h-0">
            {/* Brand Analysis Summary */}
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/30 p-4 rounded-lg mb-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span>✅</span>
                <span>Brand Analysis Complete</span>
              </div>
              
              <div className="grid grid-cols-3 gap-4 text-xs">
                <div>
                  <div className="text-gray-500">Confidence</div>
                  <div className="font-semibold">
                    {analysis.brandContext?.confidence 
                      ? (analysis.brandContext.confidence * 100).toFixed(0) 
                      : '0'}%
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">Source</div>
                  <div className="font-semibold capitalize">
                    {analysis.brandContext?.source || 'analyzing'}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">Photos</div>
                  <div className="font-semibold">{analysis.stats?.photos || 0} analyzed</div>
                </div>
              </div>
              
              {analysis.stats?.hasBrandForge && (
                <div className="text-xs text-indigo-600 dark:text-indigo-400">
                  ⭐ Using BrandForge brand book
                </div>
              )}
            </div>
            
            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
              {conversation.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg p-3 ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                    }`}
                  >
                    <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                    <div className={`text-xs mt-1 ${
                      msg.role === 'user' ? 'text-indigo-200' : 'text-gray-500'
                    }`}>
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
              
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <span className="animate-pulse">●</span>
                      <span>AI is thinking...</span>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={chatEndRef} />
            </div>
            
            {/* Input Area */}
            <div className="border-t pt-4 space-y-2">
              <Textarea
                value={userInput}
                onChange={e => setUserInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendMessage()
                  }
                }}
                placeholder="Type your response... (e.g., 'Focus more on the pool and add virtual tour options')"
                rows={3}
                disabled={loading}
                className="resize-none"
              />
              
              <div className="flex justify-between items-center">
                <div className="text-xs text-gray-500">
                  Press Enter to send, Shift+Enter for new line
                </div>
                <Button
                  onClick={sendMessage}
                  disabled={loading || !userInput.trim()}
                >
                  Send →
                </Button>
              </div>
            </div>
          </div>
        )}
        
        {/* Phase 3: Confirmation */}
        {phase === 'confirmation' && (
          <div className="space-y-4 py-4">
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 border border-green-200 dark:border-green-800 rounded-lg p-6">
              <div className="flex items-center gap-2 text-green-700 dark:text-green-400 font-bold text-lg mb-2">
                <span>✅</span>
                <span>Ready to Generate!</span>
              </div>
              <p className="text-sm text-green-600 dark:text-green-400">
                Your website plan is complete. Click below to start the agentic generation system.
              </p>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-medium flex items-center gap-2">
                <span>📋</span>
                Your Approved Plan:
              </h4>
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-sm space-y-3 max-h-60 overflow-y-auto">
                {conversation.filter(m => m.role === 'assistant').slice(-1).map((msg, idx) => (
                  <div key={idx} className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                    {msg.content}
                  </div>
                ))}
              </div>
            </div>
            
            <div className="flex justify-between pt-4">
              <Button
                variant="outline"
                onClick={() => setPhase('conversation')}
                disabled={loading}
              >
                ← Make Changes
              </Button>
              <Button
                onClick={startGeneration}
                disabled={loading}
                className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700"
              >
                {loading ? (
                  <>
                    <span className="animate-spin mr-2">⚙️</span>
                    Starting...
                  </>
                ) : (
                  <>🚀 Generate Website</>
                )}
              </Button>
            </div>
          </div>
        )}
        
        {/* Phase 4: Generating */}
        {phase === 'generating' && (
          <div className="py-8 space-y-6">
            <div className="text-center">
              <div className="text-lg font-medium mb-2">
                {generationStep || 'Generating your website...'}
              </div>
              <div className="text-sm text-gray-500">
                This typically takes 3-5 minutes
              </div>
            </div>
            
            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                <span>Progress</span>
                <span>{generationProgress}%</span>
              </div>
              <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-600 to-purple-600 transition-all duration-500 ease-out"
                  style={{ width: `${generationProgress}%` }}
                />
              </div>
            </div>
            
            {/* Agent Status */}
            <div className="space-y-2">
              <AgentStep
                label="Brand Agent"
                status={generationProgress >= 10 ? 'complete' : 'pending'}
                description="Analyzing brand context"
              />
              <AgentStep
                label="Architecture Agent"
                status={generationProgress >= 30 ? 'complete' : generationProgress >= 10 ? 'active' : 'pending'}
                description="Planning site structure"
              />
              <AgentStep
                label="Design Agent"
                status={generationProgress >= 50 ? 'complete' : generationProgress >= 30 ? 'active' : 'pending'}
                description="Creating design system"
              />
              <AgentStep
                label="Photo Agent"
                status={generationProgress >= 75 ? 'complete' : generationProgress >= 50 ? 'active' : 'pending'}
                description="Processing photos"
              />
              <AgentStep
                label="Content Agent"
                status={generationProgress >= 90 ? 'complete' : generationProgress >= 75 ? 'active' : 'pending'}
                description="Generating content"
              />
              <AgentStep
                label="Quality Agent"
                status={generationProgress >= 100 ? 'complete' : generationProgress >= 90 ? 'active' : 'pending'}
                description="Validating quality"
              />
            </div>
          </div>
        )}
        
        {/* Phase 5: Complete */}
        {phase === 'complete' && (
          <div className="py-12 text-center space-y-4">
            <div className="text-6xl mb-4">✅</div>
            <h3 className="text-2xl font-bold">Website Ready!</h3>
            <p className="text-gray-600 dark:text-gray-400">
              Redirecting to preview...
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function AgentStep({ 
  label, 
  status, 
  description 
}: { 
  label: string
  status: 'pending' | 'active' | 'complete'
  description: string 
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-900">
      <div className="flex-shrink-0">
        {status === 'complete' && <span className="text-green-600 dark:text-green-400">✅</span>}
        {status === 'active' && <span className="text-indigo-600 dark:text-indigo-400 animate-pulse">⚙️</span>}
        {status === 'pending' && <span className="text-gray-400">⏳</span>}
      </div>
      <div className="flex-1">
        <div className="font-medium text-sm">{label}</div>
        <div className="text-xs text-gray-500">{description}</div>
      </div>
    </div>
  )
}










