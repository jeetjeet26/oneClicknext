'use client'

import { brandRequest, brandResponse } from '@/utils/brandforge/client-requests'

import { useState, useRef, useEffect } from 'react'
import { Send, Loader2, Sparkles } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface ConversationInterfaceProps {
  propertyId: string
  competitiveContext: Record<string, unknown> | null
  researchId?: string | null
  onComplete: (brandAssetId: string) => void
}

export function ConversationInterface({ 
  propertyId, 
  competitiveContext,
  researchId,
  onComplete 
}: ConversationInterfaceProps) {
  const requestMemory = useRef(new Map<string, { identity: string; requestId: string }>())
  const [revision, setRevision] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [brandAssetId, setBrandAssetId] = useState<string | null>(null)
  const [activeOperation, setActiveOperation] = useState<{id:string;kind:string} | null>(null)
  const stopDecisions = useRef(new Map<string,string>())
  const pendingMessage = useRef<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const hasStartedRef = useRef(false)
  const isSendingRef = useRef(false)

  // Start conversation on mount (with guard for React StrictMode)
  useEffect(() => {
    if (hasStartedRef.current) return
    hasStartedRef.current = true
    void reloadSavedConversation(true)
    // The wizard mounts a new conversation for each property.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-focus input when not loading
  useEffect(() => {
    if (!isLoading && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isLoading, messages])

  async function reloadSavedConversation(startWhenAbsent = false) {
    if (isSendingRef.current) return
    setIsLoading(true); setErrorMessage(null)
    try {
      const status = await fetch(`/api/brandforge/status?propertyId=${encodeURIComponent(propertyId)}`, {cache:'no-store'})
      if (!status.ok) throw new Error('The saved conversation could not be loaded.')
      const found = await status.json()
      if (!found.brandAsset) {
        setRevision(0); setBrandAssetId(null); setMessages([]); setActiveOperation(null)
        if (startWhenAbsent) await startConversation(0)
        return
      }
      const response = await fetch(`/api/brandforge/revision?brandAssetId=${encodeURIComponent(found.brandAsset.id)}`, {cache:'no-store'})
      if (!response.ok) throw new Error('The saved conversation could not be loaded.')
      const saved = await response.json()
      setRevision(saved.revision); setBrandAssetId(saved.brandAssetId); setMessages(saved.conversationHistory || [])
      const operations = (saved.operations || []) as Array<{id:string;kind:string;state:string}>
      setActiveOperation(operations.find(operation => operation.state === 'running') || null)
      for (const [action, request] of requestMemory.current) {
        const operation = operations.find(item => item.id === request.requestId)
        if (operation && ['failed','cancelled','succeeded'].includes(operation.state)) {
          requestMemory.current.delete(action)
          if (action === 'message' && operation.state === 'succeeded') setInput(current => current === pendingMessage.current ? '' : current)
        }
      }
      if (!['draft','conversation'].includes(saved.generationStatus) && saved.conversationHistory?.length) onComplete(saved.brandAssetId)
    } catch (cause) { setErrorMessage(cause instanceof Error ? cause.message : 'The saved conversation could not be loaded.') }
    finally { setIsLoading(false) }
  }

  async function startConversation(savedRevision = revision) {
    if (isSendingRef.current || activeOperation) return
    isSendingRef.current = true
    setIsLoading(true); setErrorMessage(null)
    try {
      const response = await fetch('/api/brandforge/conversation', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:brandRequest(requestMemory,'start',{propertyId,revision:savedRevision,action:'start',...(researchId ? {researchId} : {competitiveContext})}),
      })
      const data = await brandResponse(response,requestMemory,'start')
      setRevision(data.revision); setBrandAssetId(data.brandAssetId); setMessages(data.conversationHistory || [])
      if (data.status === 'ready_to_generate') onComplete(data.brandAssetId)
    } catch (cause) { setErrorMessage(cause instanceof Error ? cause.message : 'The first response could not be confirmed. Reload the saved conversation.') }
    finally { setIsLoading(false); isSendingRef.current = false }
  }

  async function stopRequest() {
    if (!activeOperation || isLoading) return
    setIsLoading(true); setErrorMessage(null)
    const decisionId = stopDecisions.current.get(activeOperation.id) || crypto.randomUUID()
    stopDecisions.current.set(activeOperation.id,decisionId)
    try {
      const response = await fetch('/api/brandforge/revision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({propertyId,requestId:activeOperation.id,decisionId})})
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'The request could not be stopped.')
      await reloadSavedConversation()
    } catch (cause) { setErrorMessage(cause instanceof Error ? cause.message : 'The request could not be stopped.') }
    finally { setIsLoading(false) }
  }

  async function sendMessage() {
    // Guard against double submission
    if (!input.trim() || !brandAssetId || isLoading || activeOperation || !messages.length || isSendingRef.current) return
    
    isSendingRef.current = true
    const userMessage = input.trim()
    pendingMessage.current = userMessage
    setIsLoading(true)

    setErrorMessage(null)

    try {
      const res = await fetch('/api/brandforge/conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: brandRequest(requestMemory, 'message', { propertyId, brandAssetId, revision, action: 'message', message: userMessage })
      })

      const data = await brandResponse(res, requestMemory, 'message')
      setRevision(data.revision)
      setInput('')
      setMessages(data.conversationHistory || [])

      // Check if conversation is complete
      if (data.status === 'ready_to_generate') {
        onComplete(brandAssetId)
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Message could not be saved')
    } finally {
      setIsLoading(false)
      isSendingRef.current = false
    }
  }

  function handleKeyPress(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col h-[600px]">
      {errorMessage && <div role="alert" className="p-4 text-sm text-red-700">{errorMessage}<button type="button" className="ml-3 underline" disabled={isLoading} onClick={() => void reloadSavedConversation()}>Reload saved conversation</button></div>}
      {activeOperation && <div className="border-b border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        A {activeOperation.kind} request is still open. Reload to check its saved result, or stop it before starting another request.
        <div className="mt-2 flex gap-4"><button type="button" className="underline" disabled={isLoading} onClick={() => void reloadSavedConversation()}>Check saved response</button><button type="button" className="underline" disabled={isLoading} onClick={() => void stopRequest()}>Stop open request</button></div>
      </div>}
      {/* Header */}
      <div className="p-4 border-b border-slate-200 bg-gradient-to-r from-indigo-50 to-purple-50">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-indigo-600" />
          <h3 className="font-semibold text-slate-900">Brand strategist</h3>
        </div>
        <p className="text-sm text-slate-600 mt-1">
          Let&apos;s create your brand strategy together
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!isLoading && !messages.length && !activeOperation && <div className="rounded-lg bg-indigo-50 p-4 text-sm text-indigo-900"><p>No saved brand conversation yet. Start when you are ready.</p><button type="button" className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-white" onClick={() => void startConversation()}>Begin brand conversation</button></div>}
        {messages.map((message, idx) => (
          <div
            key={idx}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                message.role === 'user'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-900'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-slate-100 rounded-lg px-4 py-2">
              <Loader2 className="w-5 h-5 text-slate-600 animate-spin" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-slate-200 bg-white">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type your response..."
            disabled={isLoading || Boolean(activeOperation) || !messages.length}
            autoFocus
            className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50 bg-white text-slate-900 placeholder-slate-400"
          />
          <button
            onClick={sendMessage}
            aria-label="Send brand message"
            disabled={isLoading || Boolean(activeOperation) || !messages.length || !input.trim()}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}


