'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, User, Bot, Plus, RotateCcw, UserCheck, BotOff, Phone, Mail, AlertCircle } from 'lucide-react';
import { usePropertyContext } from '../layout/PropertyContext';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

interface LeadInfo {
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
}

interface ChatInterfaceProps {
  conversationId?: string | null;
  onConversationStart?: (id: string) => void;
  isAgentView?: boolean; // When true, shows agent controls
}

export function ChatInterface({ conversationId: initialConversationId, onConversationStart, isAgentView = false }: ChatInterfaceProps) {
  const { currentProperty } = usePropertyContext();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId || null);
  const [loading, setLoading] = useState(false);
  const [isHumanMode, setIsHumanMode] = useState(false);
  const [leadInfo, setLeadInfo] = useState<LeadInfo | null>(null);
  const [takingOver, setTakingOver] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load conversation if ID provided
  const loadConversation = useCallback(async (convId: string) => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/conversations?propertyId=${currentProperty.id}&conversationId=${convId}`
      );
      const data = await response.json();
      
      if (data.conversation?.messages) {
        setMessages(
          data.conversation.messages.map((m: { id: string; role: string; content: string; created_at: string }) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
            timestamp: new Date(m.created_at),
          }))
        );
        setConversationId(convId);
        setIsHumanMode(data.conversation.is_human_mode || false);
        setLeadInfo(data.conversation.lead || null);
      }
    } catch (error) {
      console.error('Failed to load conversation:', error);
    } finally {
      setLoading(false);
    }
  }, [currentProperty.id]);

  // Handle human takeover
  const handleTakeover = async () => {
    if (!conversationId) return;
    
    setTakingOver(true);
    try {
      const response = await fetch(`/api/conversations/${conversationId}/takeover`, {
        method: 'POST',
      });
      
      if (response.ok) {
        setIsHumanMode(true);
        // Reload conversation to get system message
        await loadConversation(conversationId);
      }
    } catch (error) {
      console.error('Failed to take over conversation:', error);
    } finally {
      setTakingOver(false);
    }
  };

  // Release back to AI
  const handleRelease = async () => {
    if (!conversationId) return;
    
    setTakingOver(true);
    try {
      const response = await fetch(`/api/conversations/${conversationId}/takeover`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        setIsHumanMode(false);
        // Reload conversation to get system message
        await loadConversation(conversationId);
      }
    } catch (error) {
      console.error('Failed to release conversation:', error);
    } finally {
      setTakingOver(false);
    }
  };

  useEffect(() => {
    if (initialConversationId) {
      loadConversation(initialConversationId);
    } else {
      // Start fresh conversation
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: `Hello! I'm Luma, your AI leasing assistant for ${currentProperty.name}. How can I help you today?`,
        timestamp: new Date()
      }]);
      setConversationId(null);
    }
  }, [initialConversationId, currentProperty.name, loadConversation]);

  // Reset conversation when property changes
  useEffect(() => {
    // Only reset if we're not loading a specific conversation
    if (!initialConversationId && conversationId) {
      // Property changed while in an active conversation - start fresh
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: `Hello! I'm Luma, your AI leasing assistant for ${currentProperty.name}. How can I help you today?`,
        timestamp: new Date()
      }]);
      setConversationId(null);
      setIsHumanMode(false);
      setLeadInfo(null);
    }
  }, [currentProperty.id, initialConversationId, conversationId, currentProperty.name]);

  const startNewConversation = () => {
    setMessages([{
      id: 'welcome',
      role: 'assistant',
      content: `Hello! I'm Luma, your AI leasing assistant for ${currentProperty.name}. How can I help you today?`,
      timestamp: new Date()
    }]);
    setConversationId(null);
  };

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;

    // In agent view with human mode, send as agent message
    const isAgentMessage = isAgentView && isHumanMode;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: isAgentMessage ? 'assistant' : 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages
            .filter(m => m.id !== 'welcome' && m.role !== 'system')
            .concat(userMsg)
            .map(m => ({ role: m.role, content: m.content })),
          propertyId: currentProperty.id,
          conversationId: conversationId,
          isHumanMessage: isAgentMessage,
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const fallbackError =
          typeof data?.content === 'string' && data.content.trim()
            ? data.content
            : typeof data?.error === 'string' && data.error.trim()
              ? data.error
              : `Request failed (${response.status})`;

        const errorMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: fallbackError,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, errorMsg]);
        return;
      }

      if (!data || typeof data !== 'object') {
        throw new Error('Invalid API response');
      }

      // Update conversation ID if new one was created
      if (data.conversationId && !conversationId) {
        setConversationId(data.conversationId);
        onConversationStart?.(data.conversationId);
      }

      // In human mode, don't add AI response (agent already added their message)
      if (data.isHumanMode && data.waitingForHuman) {
        // No AI response, waiting for human agent
        setIsTyping(false);
        return;
      }

      if (data.fromAgent) {
        // Agent message was saved, no need to add another
        setIsTyping(false);
        return;
      }

      // Add AI response
      if (data.content) {
        const aiResponse: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.content,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, aiResponse]);
      }
    } catch (error) {
      console.error(error);
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "I'm having trouble connecting to the server. Please try again.",
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex flex-col h-[600px] bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className={`p-4 border-b border-slate-100 flex justify-between items-center ${
        isHumanMode 
          ? 'bg-gradient-to-r from-amber-50 to-orange-50' 
          : 'bg-gradient-to-r from-slate-50 to-indigo-50/30'
      }`}>
        <div className="flex items-center space-x-3">
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center text-white shadow-sm ${
            isHumanMode 
              ? 'bg-gradient-to-br from-amber-500 to-orange-600' 
              : 'bg-gradient-to-br from-indigo-500 to-purple-600'
          }`}>
            {isHumanMode ? <UserCheck size={20} /> : <Bot size={20} />}
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              {isHumanMode ? 'Human Agent' : 'Luma AI'}
              {isHumanMode && (
                <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">
                  Live
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-500 flex items-center">
              <span className={`h-2 w-2 rounded-full mr-1.5 animate-pulse ${
                isHumanMode ? 'bg-amber-500' : 'bg-emerald-500'
              }`}></span>
              {isHumanMode ? 'Agent responding' : 'Online'} • {currentProperty.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Agent takeover controls */}
          {isAgentView && conversationId && (
            <>
              {isHumanMode ? (
                <button 
                  onClick={handleRelease}
                  disabled={takingOver}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Bot size={16} />
                  {takingOver ? 'Releasing...' : 'Return to AI'}
                </button>
              ) : (
                <button 
                  onClick={handleTakeover}
                  disabled={takingOver}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-amber-600 hover:text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  <UserCheck size={16} />
                  {takingOver ? 'Taking over...' : 'Take Over'}
                </button>
              )}
            </>
          )}
          {conversationId && !isAgentView && (
            <button 
              onClick={startNewConversation}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
            >
              <Plus size={16} />
              New Chat
            </button>
          )}
        </div>
      </div>

      {/* Lead Info Banner (Agent View) */}
      {isAgentView && leadInfo && (
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-slate-700">
              {leadInfo.first_name} {leadInfo.last_name}
            </span>
            {leadInfo.email && (
              <a href={`mailto:${leadInfo.email}`} className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600">
                <Mail size={12} />
                {leadInfo.email}
              </a>
            )}
            {leadInfo.phone && (
              <a href={`tel:${leadInfo.phone}`} className="flex items-center gap-1 text-xs text-slate-500 hover:text-emerald-600">
                <Phone size={12} />
                {leadInfo.phone}
              </a>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex items-center gap-2 text-slate-500">
              <RotateCcw size={18} className="animate-spin" />
              Loading conversation...
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => {
              // System messages (takeover notifications)
              if (msg.role === 'system') {
                return (
                  <div key={msg.id} className="flex justify-center">
                    <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 rounded-full text-xs text-slate-600">
                      <AlertCircle size={12} />
                      {msg.content}
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`flex max-w-[80%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center mx-2 ${
                      msg.role === 'user' 
                        ? 'bg-slate-200 text-slate-600' 
                        : isHumanMode
                          ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-sm'
                          : 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-sm'
                    }`}>
                      {msg.role === 'user' ? <User size={16} /> : isHumanMode ? <UserCheck size={16} /> : <Bot size={16} />}
                    </div>
                    <div className={`p-3 rounded-2xl text-sm shadow-sm ${
                      msg.role === 'user' 
                        ? 'bg-white text-slate-900 rounded-tr-md border border-slate-100' 
                        : isHumanMode
                          ? 'bg-gradient-to-br from-amber-500 to-orange-500 text-white rounded-tl-md'
                          : 'bg-gradient-to-br from-indigo-600 to-purple-600 text-white rounded-tl-md'
                    }`}>
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                      <p className={`text-[10px] mt-1.5 text-right ${
                        msg.role === 'user' ? 'text-slate-400' : isHumanMode ? 'text-amber-200' : 'text-indigo-200'
                      }`}>
                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
            {isTyping && (
              <div className="flex justify-start">
                <div className="flex flex-row items-center">
                  <div className="flex-shrink-0 h-8 w-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center mx-2 text-white shadow-sm">
                    <Bot size={16} />
                  </div>
                  <div className="bg-white p-3 rounded-2xl rounded-tl-md shadow-sm border border-slate-100">
                    <div className="flex space-x-1.5">
                      <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                      <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                      <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div className={`p-4 border-t border-slate-100 ${isHumanMode && isAgentView ? 'bg-amber-50/50' : 'bg-white'}`}>
        <div className="flex items-center space-x-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder={
              isHumanMode && isAgentView 
                ? `Reply as agent to ${leadInfo?.first_name || 'lead'}...`
                : "Type a message..."
            }
            disabled={isTyping || loading}
            className={`flex-1 border rounded-full px-4 py-2.5 text-sm bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-400 ${
              isHumanMode && isAgentView
                ? 'border-amber-200 focus:border-amber-500 focus:ring-amber-500/20'
                : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20'
            }`}
          />
          <button 
            onClick={handleSend}
            disabled={!input.trim() || isTyping || loading}
            className={`p-2.5 text-white rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md ${
              isHumanMode && isAgentView
                ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600'
                : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700'
            }`}
          >
            <Send size={18} />
          </button>
        </div>
        <div className="flex items-center justify-between mt-2">
          {conversationId && (
            <p className="text-xs text-slate-400">
              Conversation ID: {conversationId.slice(0, 8)}...
            </p>
          )}
          {isHumanMode && isAgentView && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <UserCheck size={12} />
              Responding as human agent
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
