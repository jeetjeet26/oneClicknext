'use client';

/**
 * Internal-only React reference widget. Not the canonical client embed.
 *
 * Clients embed LumaLeasing via `public/lumaleasing.js`. This component is
 * retained for in-app preview and prototyping inside the dashboard; the
 * `/lumaleasing/demo` route now loads the embed script directly so the
 * preview matches what clients actually deploy. Do NOT recommend or document
 * this component as the public widget for property sites.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, User, Bot, Calendar, ChevronLeft, Loader2, CheckCircle2, Sparkles } from 'lucide-react';

// Types
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

interface WidgetConfig {
  widgetName: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl?: string;
  welcomeMessage: string;
  offlineMessage: string;
  autoPopupDelay: number;
  requireEmailBeforeChat: boolean;
  collectName: boolean;
  collectEmail: boolean;
  collectPhone: boolean;
  leadCapturePrompt: string;
  toursEnabled: boolean;
  propertyName: string;
}

interface TourSlot {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  available: number;
}

interface LeadInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

interface LumaLeasingWidgetProps {
  apiKey: string;
  apiUrl?: string;
  position?: 'bottom-right' | 'bottom-left';
  zIndex?: number;
}

// Generate unique visitor ID
function getVisitorId(): string {
  const key = 'lumaleasing_visitor_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = `v_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

// Main Widget Component
export function LumaLeasingWidget({
  apiKey,
  apiUrl = '',
  position = 'bottom-right',
  zIndex = 9999,
}: LumaLeasingWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  
  // Lead capture state
  const [showLeadCapture, setShowLeadCapture] = useState(false);
  const [leadInfo, setLeadInfo] = useState<LeadInfo>({ firstName: '', lastName: '', email: '', phone: '' });
  const [leadCaptured, setLeadCaptured] = useState(false);
  
  // Tour booking state
  const [showTourBooking, setShowTourBooking] = useState(false);
  const [tourSlots, setTourSlots] = useState<Record<string, TourSlot[]>>({});
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TourSlot | null>(null);
  const [bookingTour, setBookingTour] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const visitorId = useRef<string>('');

  // Load config on mount
  useEffect(() => {
    visitorId.current = getVisitorId();
    loadConfig();
  }, [apiKey]);

  // Auto-popup
  useEffect(() => {
    if (config?.autoPopupDelay && config.autoPopupDelay > 0 && !isOpen) {
      const timer = setTimeout(() => {
        setIsOpen(true);
      }, config.autoPopupDelay * 1000);
      return () => clearTimeout(timer);
    }
  }, [config?.autoPopupDelay, isOpen]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadConfig = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/lumaleasing/config`, {
        headers: { 'X-API-Key': apiKey },
      });
      
      if (!res.ok) throw new Error('Failed to load widget');
      
      const data = await res.json();
      setConfig(data.config);
      setIsOnline(data.isOnline);
      
      // Set welcome message
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: data.config.welcomeMessage,
        timestamp: new Date(),
      }]);
      
      setLoading(false);
    } catch (err) {
      console.error('LumaLeasing config error:', err);
      setError('Widget unavailable');
      setLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isTyping || !config) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const res = await fetch(`${apiUrl}/api/lumaleasing/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
          'X-Visitor-ID': visitorId.current,
        },
        body: JSON.stringify({
          messages: messages
            .filter(m => m.id !== 'welcome')
            .concat(userMsg)
            .map(m => ({ role: m.role, content: m.content })),
          sessionId,
          leadInfo: leadCaptured ? leadInfo : undefined,
        }),
      });

      const data = await res.json();

      if (data.sessionId) setSessionId(data.sessionId);
      if (data.conversationId) setConversationId(data.conversationId);

      // Check if human mode (waiting for agent)
      if (data.isHumanMode && data.waitingForHuman) {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'system',
          content: 'A team member will respond shortly. Thanks for your patience!',
          timestamp: new Date(),
        }]);
        setIsTyping(false);
        return;
      }

      // Add AI response
      if (data.content) {
        const aiMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.content,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, aiMsg]);
      }

      // Check if should prompt lead capture
      if (data.shouldPromptLeadCapture && !leadCaptured) {
        setTimeout(() => setShowLeadCapture(true), 1000);
      }

      // Check if tour interest detected
      if (data.wantsTour && config.toursEnabled && !showTourBooking) {
        // Add tour prompt after a delay
        setTimeout(() => {
          setMessages(prev => [...prev, {
            id: 'tour-prompt',
            role: 'system',
            content: '📅 Would you like to schedule a tour?',
            timestamp: new Date(),
          }]);
        }, 1500);
      }

    } catch (err) {
      console.error('Chat error:', err);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: "I'm having trouble connecting. Please try again!",
        timestamp: new Date(),
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleLeadCapture = async () => {
    if (!leadInfo.email && !leadInfo.phone) return;

    try {
      const res = await fetch(`${apiUrl}/api/lumaleasing/lead`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          sessionId,
          firstName: leadInfo.firstName,
          lastName: leadInfo.lastName,
          email: leadInfo.email,
          phone: leadInfo.phone,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setLeadCaptured(true);
        setShowLeadCapture(false);
        setMessages(prev => [...prev, {
          id: 'lead-captured',
          role: 'assistant',
          content: data.message,
          timestamp: new Date(),
        }]);
      }
    } catch (err) {
      console.error('Lead capture error:', err);
    }
  };

  const loadTourSlots = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/lumaleasing/tours`, {
        headers: { 'X-API-Key': apiKey },
      });
      const data = await res.json();
      setTourSlots(data.slots || {});
    } catch (err) {
      console.error('Tour slots error:', err);
    }
  };

  const bookTour = async () => {
    if (!selectedSlot || !leadInfo.email) return;

    setBookingTour(true);
    try {
      const res = await fetch(`${apiUrl}/api/lumaleasing/tours`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          slotId: selectedSlot.id,
          leadInfo,
          sessionId,
          conversationId,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setShowTourBooking(false);
        setLeadCaptured(true);
        setMessages(prev => [...prev, {
          id: 'tour-booked',
          role: 'assistant',
          content: `🎉 ${data.message}`,
          timestamp: new Date(),
        }]);
      }
    } catch (err) {
      console.error('Tour booking error:', err);
    } finally {
      setBookingTour(false);
    }
  };

  // CSS variables based on config
  const cssVars = config ? {
    '--ll-primary': config.primaryColor,
    '--ll-secondary': config.secondaryColor,
  } as React.CSSProperties : {};

  if (loading) return null;
  if (error) return null;
  if (!config) return null;

  const positionClasses = position === 'bottom-left' ? 'left-4' : 'right-4';

  return (
    <div style={{ ...cssVars, zIndex }} className="lumaleasing-widget">
      {/* Widget Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className={`fixed bottom-4 ${positionClasses} w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110`}
          style={{ backgroundColor: config.primaryColor }}
        >
          <MessageCircle className="w-6 h-6 text-white" />
          {!isOnline && (
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-amber-400 rounded-full border-2 border-white" />
          )}
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div
          className={`fixed bottom-4 ${positionClasses} w-[380px] h-[600px] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-gray-100`}
          style={{ maxHeight: 'calc(100vh - 100px)' }}
        >
          {/* Header */}
          <div
            className="p-4 flex items-center justify-between text-white"
            style={{ background: `linear-gradient(135deg, ${config.primaryColor}, ${config.secondaryColor})` }}
          >
            <div className="flex items-center gap-3">
              {config.logoUrl ? (
                <img src={config.logoUrl} alt="" className="w-10 h-10 rounded-full bg-white/20" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                  <Sparkles className="w-5 h-5" />
                </div>
              )}
              <div>
                <h3 className="font-semibold">{config.widgetName}</h3>
                <p className="text-xs text-white/80 flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-400' : 'bg-amber-400'}`} />
                  {isOnline ? 'Online' : 'Away'}
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-2 hover:bg-white/20 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tour Booking View */}
          {showTourBooking ? (
            <TourBookingView
              slots={tourSlots}
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
              selectedSlot={selectedSlot}
              setSelectedSlot={setSelectedSlot}
              leadInfo={leadInfo}
              setLeadInfo={setLeadInfo}
              onBook={bookTour}
              onBack={() => setShowTourBooking(false)}
              booking={bookingTour}
              config={config}
            />
          ) : showLeadCapture ? (
            <LeadCaptureView
              config={config}
              leadInfo={leadInfo}
              setLeadInfo={setLeadInfo}
              onSubmit={handleLeadCapture}
              onSkip={() => setShowLeadCapture(false)}
            />
          ) : (
            <>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
                {messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    config={config}
                    onScheduleTour={config.toursEnabled ? () => {
                      loadTourSlots();
                      setShowTourBooking(true);
                    } : undefined}
                  />
                ))}
                {isTyping && (
                  <div className="flex items-center gap-2">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white"
                      style={{ backgroundColor: config.primaryColor }}
                    >
                      <Bot className="w-4 h-4" />
                    </div>
                    <div className="bg-white p-3 rounded-2xl rounded-bl-md shadow-sm">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="p-4 border-t border-gray-100 bg-white">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                    placeholder="Type a message..."
                    className="flex-1 px-4 py-2.5 rounded-full border border-gray-200 focus:outline-none focus:border-gray-400 text-sm"
                    disabled={isTyping}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={!input.trim() || isTyping}
                    className="p-2.5 rounded-full text-white disabled:opacity-50 transition-colors"
                    style={{ backgroundColor: config.primaryColor }}
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 text-center mt-2">
                  Powered by LumaLeasing
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Message Bubble Component
function MessageBubble({
  message,
  config,
  onScheduleTour,
}: {
  message: Message;
  config: WidgetConfig;
  onScheduleTour?: () => void;
}) {
  if (message.role === 'system') {
    return (
      <div className="flex justify-center">
        <div className="bg-white px-4 py-2 rounded-full text-xs text-gray-600 shadow-sm flex items-center gap-2">
          {message.content}
          {message.id === 'tour-prompt' && onScheduleTour && (
            <button
              onClick={onScheduleTour}
              className="ml-2 px-3 py-1 rounded-full text-white text-xs font-medium"
              style={{ backgroundColor: config.primaryColor }}
            >
              Schedule Tour
            </button>
          )}
        </div>
      </div>
    );
  }

  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex items-end gap-2 max-w-[85%] ${isUser ? 'flex-row-reverse' : ''}`}>
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
            isUser ? 'bg-gray-200' : 'text-white'
          }`}
          style={!isUser ? { backgroundColor: config.primaryColor } : {}}
        >
          {isUser ? <User className="w-4 h-4 text-gray-600" /> : <Bot className="w-4 h-4" />}
        </div>
        <div
          className={`p-3 rounded-2xl text-sm ${
            isUser
              ? 'bg-white rounded-br-md shadow-sm text-gray-800'
              : 'text-white rounded-bl-md'
          }`}
          style={!isUser ? { background: `linear-gradient(135deg, ${config.primaryColor}, ${config.secondaryColor})` } : {}}
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
          <p className={`text-[10px] mt-1 ${isUser ? 'text-gray-400' : 'text-white/70'}`}>
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </div>
    </div>
  );
}

// Lead Capture Form
function LeadCaptureView({
  config,
  leadInfo,
  setLeadInfo,
  onSubmit,
  onSkip,
}: {
  config: WidgetConfig;
  leadInfo: LeadInfo;
  setLeadInfo: (info: LeadInfo) => void;
  onSubmit: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex-1 p-6 flex flex-col">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Let's stay in touch!</h3>
        <p className="text-sm text-gray-500 mt-1">{config.leadCapturePrompt}</p>
      </div>

      <div className="space-y-4 flex-1">
        {config.collectName && (
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="First name"
              value={leadInfo.firstName}
              onChange={(e) => setLeadInfo({ ...leadInfo, firstName: e.target.value })}
              className="px-4 py-2.5 rounded-lg border border-gray-200 focus:outline-none focus:border-gray-400 text-sm"
            />
            <input
              type="text"
              placeholder="Last name"
              value={leadInfo.lastName}
              onChange={(e) => setLeadInfo({ ...leadInfo, lastName: e.target.value })}
              className="px-4 py-2.5 rounded-lg border border-gray-200 focus:outline-none focus:border-gray-400 text-sm"
            />
          </div>
        )}
        {config.collectEmail && (
          <input
            type="email"
            placeholder="Email address *"
            value={leadInfo.email}
            onChange={(e) => setLeadInfo({ ...leadInfo, email: e.target.value })}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:outline-none focus:border-gray-400 text-sm"
          />
        )}
        {config.collectPhone && (
          <input
            type="tel"
            placeholder="Phone number"
            value={leadInfo.phone}
            onChange={(e) => setLeadInfo({ ...leadInfo, phone: e.target.value })}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:outline-none focus:border-gray-400 text-sm"
          />
        )}
      </div>

      <div className="space-y-2 mt-6">
        <button
          onClick={onSubmit}
          disabled={!leadInfo.email && !leadInfo.phone}
          className="w-full py-3 rounded-lg text-white font-medium disabled:opacity-50 transition-colors"
          style={{ backgroundColor: config.primaryColor }}
        >
          Continue
        </button>
        <button
          onClick={onSkip}
          className="w-full py-2 text-sm text-gray-500 hover:text-gray-700"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}

// Tour Booking View
function TourBookingView({
  slots,
  selectedDate,
  setSelectedDate,
  selectedSlot,
  setSelectedSlot,
  leadInfo,
  setLeadInfo,
  onBook,
  onBack,
  booking,
  config,
}: {
  slots: Record<string, TourSlot[]>;
  selectedDate: string | null;
  setSelectedDate: (date: string | null) => void;
  selectedSlot: TourSlot | null;
  setSelectedSlot: (slot: TourSlot | null) => void;
  leadInfo: LeadInfo;
  setLeadInfo: (info: LeadInfo) => void;
  onBook: () => void;
  onBack: () => void;
  booking: boolean;
  config: WidgetConfig;
}) {
  const dates = Object.keys(slots).sort();

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    return {
      day: date.toLocaleDateString('en-US', { weekday: 'short' }),
      date: date.getDate(),
      month: date.toLocaleDateString('en-US', { month: 'short' }),
    };
  };

  const formatTime = (timeStr: string) => {
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-100 flex items-center gap-3">
        <button onClick={onBack} className="p-1 hover:bg-gray-100 rounded-full">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div>
          <h3 className="font-semibold text-gray-900">Schedule a Tour</h3>
          <p className="text-xs text-gray-500">Select a date and time</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Date Selection */}
        <div className="mb-4">
          <p className="text-sm font-medium text-gray-700 mb-2">Select a date</p>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {dates.length === 0 ? (
              <p className="text-sm text-gray-500">No available dates</p>
            ) : (
              dates.slice(0, 7).map((date) => {
                const { day, date: dayNum, month } = formatDate(date);
                const isSelected = selectedDate === date;
                return (
                  <button
                    key={date}
                    onClick={() => {
                      setSelectedDate(date);
                      setSelectedSlot(null);
                    }}
                    className={`flex flex-col items-center p-3 rounded-lg border-2 transition-colors min-w-[70px] ${
                      isSelected ? 'border-current text-white' : 'border-gray-200 hover:border-gray-300'
                    }`}
                    style={isSelected ? { backgroundColor: config.primaryColor, borderColor: config.primaryColor } : {}}
                  >
                    <span className="text-xs font-medium">{day}</span>
                    <span className="text-lg font-bold">{dayNum}</span>
                    <span className="text-xs">{month}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Time Selection */}
        {selectedDate && slots[selectedDate] && (
          <div className="mb-4">
            <p className="text-sm font-medium text-gray-700 mb-2">Select a time</p>
            <div className="grid grid-cols-3 gap-2">
              {slots[selectedDate].map((slot) => {
                const isSelected = selectedSlot?.id === slot.id;
                return (
                  <button
                    key={slot.id}
                    onClick={() => setSelectedSlot(slot)}
                    className={`py-2 px-3 rounded-lg border-2 text-sm font-medium transition-colors ${
                      isSelected ? 'text-white' : 'border-gray-200 hover:border-gray-300'
                    }`}
                    style={isSelected ? { backgroundColor: config.primaryColor, borderColor: config.primaryColor } : {}}
                  >
                    {formatTime(slot.startTime)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Contact Info */}
        {selectedSlot && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-700">Your information</p>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="First name"
                value={leadInfo.firstName}
                onChange={(e) => setLeadInfo({ ...leadInfo, firstName: e.target.value })}
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm"
              />
              <input
                type="text"
                placeholder="Last name"
                value={leadInfo.lastName}
                onChange={(e) => setLeadInfo({ ...leadInfo, lastName: e.target.value })}
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm"
              />
            </div>
            <input
              type="email"
              placeholder="Email address *"
              value={leadInfo.email}
              onChange={(e) => setLeadInfo({ ...leadInfo, email: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
            />
            <input
              type="tel"
              placeholder="Phone number"
              value={leadInfo.phone}
              onChange={(e) => setLeadInfo({ ...leadInfo, phone: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
            />
          </div>
        )}
      </div>

      {/* Book Button */}
      {selectedSlot && (
        <div className="p-4 border-t border-gray-100">
          <button
            onClick={onBook}
            disabled={!leadInfo.email || booking}
            className="w-full py-3 rounded-lg text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ backgroundColor: config.primaryColor }}
          >
            {booking ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Booking...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Confirm Tour
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

export default LumaLeasingWidget;

