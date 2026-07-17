/**
 * LumaLeasing Widget Loader
 * Embeddable AI leasing assistant for multifamily properties
 * 
 * Usage:
 * <script>
 *   (function(w,d,s,o,f,js,fjs){
 *     w['LumaLeasing']=o;w[o]=w[o]||function(){(w[o].q=w[o].q||[]).push(arguments)};
 *     js=d.createElement(s);fjs=d.getElementsByTagName(s)[0];
 *     js.id=o;js.src=f;js.async=1;fjs.parentNode.insertBefore(js,fjs);
 *   }(window,document,'script','lumaleasing','https://your-domain.com/lumaleasing.js'));
 *   lumaleasing('init', 'YOUR_API_KEY');
 * </script>
 */

(function() {
  'use strict';

  // Configuration
  const WIDGET_VERSION = '1.0.0';
  
  // API_BASE is read dynamically to handle async script loading
  function getApiBase() {
    return window.LUMALEASING_API_BASE || '';
  }
  
  // State
  let config = null;
  let isOpen = false;
  let messages = [];
  let sessionId = getStoredSessionId();
  let conversationId = null;
  let leadCaptured = false;
  let leadInfo = { firstName: '', lastName: '', email: '', phone: '' };
  let isTyping = false;
  let visitorId = getVisitorId();
  
  // Calendar state
  let widgetMode = 'chat'; // 'chat' | 'calendar' | 'confirmation'
  let calendarData = null;
  let selectedDate = null;
  let selectedTime = null;
  let calendarViewDate = null;

  // Get or create visitor ID
  function getVisitorId() {
    const key = 'lumaleasing_visitor_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
      localStorage.setItem(key, id);
    }
    return id;
  }

  function getStoredSessionId() {
    try {
      return localStorage.getItem('lumaleasing_session_id');
    } catch (e) {
      return null;
    }
  }

  function setStoredSessionId(id) {
    sessionId = id || null;
    try {
      if (id) localStorage.setItem('lumaleasing_session_id', id);
      else localStorage.removeItem('lumaleasing_session_id');
    } catch (e) {
      // Ignore storage errors; widget can still function in-memory.
    }
  }

  // Capture queued commands from the bootstrap stub before replacing it below.
  const queuedCommands = (window.lumaleasing && window.lumaleasing.q) || [];

  // Process queued commands
  function processQueue() {
    const queue = queuedCommands || [];
    queue.forEach(function(args) {
      handleCommand.apply(null, args);
    });
  }

  // Handle commands
  function handleCommand(command, arg1, arg2) {
    switch (command) {
      case 'init':
        initWidget(arg1, arg2);
        break;
      case 'open':
        openWidget();
        break;
      case 'close':
        closeWidget();
        break;
      case 'destroy':
        destroyWidget();
        break;
    }
  }

  // Initialize widget
  async function initWidget(apiKey, options) {
    if (!apiKey) {
      console.error('LumaLeasing: API key required');
      return;
    }

    options = options || {};

    try {
      const response = await fetch(getApiBase() + '/api/lumaleasing/config', {
        headers: { 'X-API-Key': apiKey }
      });

      if (!response.ok) {
        throw new Error('Failed to load widget configuration');
      }

      const data = await response.json();
      config = data.config;
      config.apiKey = apiKey;
      config.isOnline = data.isOnline;
      config.position = options.position || 'bottom-right';

      // Add welcome message
      messages = [{
        id: 'welcome',
        role: 'assistant',
        content: config.welcomeMessage,
        timestamp: new Date()
      }];

      // Inject styles
      injectStyles();

      // Render widget
      renderWidget();

      // Global Esc-to-close keyboard handler.
      attachGlobalKeyHandler();

      // Auto-popup
      if (config.autoPopupDelay > 0) {
        setTimeout(function() {
          openWidget();
        }, config.autoPopupDelay * 1000);
      }

    } catch (error) {
      console.error('LumaLeasing init error:', error);
      injectStyles();
      renderError('Chat is temporarily unavailable. Please refresh or contact us directly.');
    }
  }

  // Render a minimal launcher in error mode so the visitor never sees an empty corner.
  function renderError(message) {
    const existing = document.getElementById('lumaleasing-widget');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'lumaleasing-widget';
    container.className = 'll-widget bottom-right';
    container.innerHTML = `
      <div role="status" aria-live="polite" style="
        background: #fff;
        color: #1f2937;
        padding: 12px 16px;
        border-radius: 12px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        max-width: 280px;
        font-size: 13px;
        line-height: 1.4;
      ">
        ${escapeHtml(message)}
      </div>
    `;
    document.body.appendChild(container);
  }

  let globalKeyHandlerAttached = false;
  function attachGlobalKeyHandler() {
    if (globalKeyHandlerAttached) return;
    globalKeyHandlerAttached = true;
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && isOpen) {
        closeWidget();
      }
    });
  }

  // Inject CSS styles
  function injectStyles() {
    if (document.getElementById('lumaleasing-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'lumaleasing-styles';
    styles.textContent = `
      .ll-widget * {
        box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      }
      .ll-widget {
        position: fixed;
        z-index: 999999;
      }
      .ll-widget.bottom-right { right: 16px; bottom: 16px; }
      .ll-widget.bottom-left { left: 16px; bottom: 16px; }
      
      .ll-button {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        transition: transform 0.2s, box-shadow 0.2s;
      }
      .ll-button:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 16px rgba(0,0,0,0.2);
      }
      .ll-button svg {
        width: 24px;
        height: 24px;
        fill: white;
      }
      .ll-button .ll-status {
        position: absolute;
        top: -2px;
        right: -2px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        border: 2px solid white;
      }
      .ll-button .ll-status.online { background: #10b981; }
      .ll-button .ll-status.offline { background: #f59e0b; }
      
      .ll-window {
        width: 380px;
        height: 600px;
        max-height: calc(100vh - 100px);
        background: white;
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.15);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      
      .ll-header {
        padding: 16px;
        color: white;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .ll-header-info {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .ll-avatar {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: rgba(255,255,255,0.2);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .ll-avatar.ll-avatar-logo {
        background: transparent;
        border-radius: 0;
      }
      .ll-avatar svg {
        width: 20px;
        height: 20px;
        fill: white;
      }
      .ll-name {
        font-weight: 600;
        font-size: 16px;
      }
      .ll-status-text {
        font-size: 12px;
        opacity: 0.8;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .ll-status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
      }
      .ll-status-dot.online { background: #10b981; }
      .ll-status-dot.offline { background: #f59e0b; }
      .ll-close {
        background: rgba(255,255,255,0.2);
        border: none;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      }
      .ll-close:hover {
        background: rgba(255,255,255,0.3);
      }
      .ll-close svg {
        width: 20px;
        height: 20px;
        fill: white;
      }
      
      .ll-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        background: #f9fafb;
      }
      .ll-message {
        display: flex;
        margin-bottom: 12px;
      }
      .ll-message.user {
        justify-content: flex-end;
      }
      .ll-message-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        margin: 0 8px;
      }
      .ll-message.user .ll-message-avatar {
        background: #e5e7eb;
        order: 1;
      }
      .ll-message.assistant .ll-message-avatar {
        color: white;
      }
      .ll-message-avatar svg {
        width: 16px;
        height: 16px;
      }
      .ll-message-bubble {
        max-width: 80%;
        padding: 12px 16px;
        border-radius: 16px;
        font-size: 14px;
        line-height: 1.4;
      }
      .ll-message.user .ll-message-bubble {
        background: white;
        color: #1f2937;
        border-bottom-right-radius: 4px;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
      }
      .ll-message.assistant .ll-message-bubble {
        color: white;
        border-bottom-left-radius: 4px;
      }
      .ll-message-time {
        font-size: 10px;
        margin-top: 4px;
        text-align: right;
        opacity: 0.7;
      }
      
      .ll-typing {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 12px 16px;
        background: white;
        border-radius: 16px;
        border-bottom-left-radius: 4px;
        width: fit-content;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
      }
      .ll-typing-dot {
        width: 8px;
        height: 8px;
        background: #9ca3af;
        border-radius: 50%;
        animation: ll-bounce 1.4s infinite;
      }
      .ll-typing-dot:nth-child(2) { animation-delay: 0.15s; }
      .ll-typing-dot:nth-child(3) { animation-delay: 0.3s; }
      @keyframes ll-bounce {
        0%, 60%, 100% { transform: translateY(0); }
        30% { transform: translateY(-4px); }
      }
      
      .ll-input-area {
        padding: 16px;
        background: white;
        border-top: 1px solid #e5e7eb;
      }
      .ll-input-row {
        display: flex;
        gap: 8px;
      }
      .ll-input {
        flex: 1;
        padding: 12px 16px;
        border: 1px solid #e5e7eb;
        border-radius: 24px;
        font-size: 14px;
        outline: none;
        transition: border-color 0.2s;
      }
      .ll-input:focus {
        border-color: #9ca3af;
      }
      .ll-send {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: opacity 0.2s;
      }
      .ll-send:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .ll-send svg {
        width: 18px;
        height: 18px;
        fill: white;
      }
      .ll-powered {
        text-align: center;
        font-size: 10px;
        color: #9ca3af;
        margin-top: 8px;
      }
      
      .ll-system {
        display: flex;
        justify-content: center;
        margin-bottom: 12px;
      }
      .ll-system-bubble {
        background: white;
        padding: 8px 16px;
        border-radius: 20px;
        font-size: 12px;
        color: #6b7280;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
      }
      
      /* Calendar Styles */
      .ll-calendar-content {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
        background: #f9fafb;
      }
      .ll-calendar-header {
        text-align: center;
        margin-bottom: 20px;
      }
      .ll-calendar-header h3 {
        margin: 0 0 8px;
        font-size: 20px;
        font-weight: 600;
        color: #111827;
      }
      .ll-calendar-subtitle {
        margin: 0;
        font-size: 14px;
        color: #6b7280;
      }
      .ll-calendar-weekdays {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 4px;
        margin-bottom: 8px;
      }
      .ll-calendar-weekday {
        text-align: center;
        font-size: 12px;
        font-weight: 600;
        color: #6b7280;
        padding: 8px 0;
      }
      .ll-calendar-grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 4px;
      }
      .ll-calendar-day {
        aspect-ratio: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        transition: all 0.2s;
      }
      .ll-calendar-day-empty {
        background: transparent;
      }
      .ll-calendar-day-past {
        color: #d1d5db;
        background: #fafafa;
      }
      .ll-calendar-day-unavailable {
        color: #9ca3af;
        background: #f3f4f6;
      }
      .ll-calendar-day-available {
        color: #111827;
        background: white;
        cursor: pointer;
        border: 2px solid #e5e7eb;
      }
      .ll-calendar-day-available:hover {
        border-color: currentColor;
        transform: scale(1.05);
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      }
      .ll-calendar-day-today {
        border-color: #6366f1;
        font-weight: 600;
      }
      .ll-time-slots {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
        margin-bottom: 20px;
      }
      .ll-time-slot {
        padding: 12px 16px;
        background: white;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }
      .ll-time-slot:hover {
        border-color: currentColor;
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      }
      .ll-calendar-footer {
        margin-top: 16px;
        display: flex;
        justify-content: center;
      }
      .ll-button-secondary {
        padding: 10px 20px;
        background: white;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }
      .ll-button-secondary:hover {
        border-color: #9ca3af;
        background: #f9fafb;
      }
      .ll-button-primary {
        padding: 12px 24px;
        background: #6366f1;
        border: none;
        border-radius: 8px;
        color: white;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }
      .ll-button-primary:hover {
        opacity: 0.9;
        transform: translateY(-1px);
      }
      .ll-button-primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }
      .ll-confirmation-summary {
        text-align: center;
        padding: 24px;
        background: white;
        border-radius: 12px;
        margin-bottom: 24px;
      }
      .ll-confirmation-icon {
        width: 64px;
        height: 64px;
        margin: 0 auto 16px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 32px;
      }
      .ll-confirmation-summary h3 {
        margin: 0 0 8px;
        font-size: 18px;
        font-weight: 600;
        color: #111827;
      }
      .ll-confirmation-time {
        margin: 0;
        font-size: 16px;
        color: #6b7280;
      }
      .ll-booking-form {
        background: white;
        padding: 20px;
        border-radius: 12px;
      }
      .ll-form-group {
        margin-bottom: 16px;
      }
      .ll-form-group label {
        display: block;
        margin-bottom: 6px;
        font-size: 13px;
        font-weight: 500;
        color: #374151;
      }
      .ll-form-group input,
      .ll-form-group textarea {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 14px;
        font-family: inherit;
        transition: border-color 0.2s;
      }
      .ll-form-group input:focus,
      .ll-form-group textarea:focus {
        outline: none;
        border-color: #6366f1;
      }
      .ll-form-actions {
        display: flex;
        gap: 12px;
        margin-top: 20px;
      }
      .ll-form-actions button {
        flex: 1;
      }
      .ll-error-message {
        text-align: center;
        padding: 40px 20px;
      }
      .ll-error-message p {
        margin: 16px 0 24px;
        color: #6b7280;
        line-height: 1.5;
      }
    `;
    document.head.appendChild(styles);
  }

  // Render widget
  function renderWidget() {
    if (!config) return;

    // Remove existing widget
    const existing = document.getElementById('lumaleasing-widget');
    if (existing) existing.remove();

    // Create container
    const container = document.createElement('div');
    container.id = 'lumaleasing-widget';
    container.className = 'll-widget ' + config.position;

    if (isOpen) {
      if (widgetMode === 'calendar' && calendarData) {
        container.innerHTML = renderCalendar();
      } else if (widgetMode === 'confirmation') {
        container.innerHTML = renderConfirmation();
      } else {
        container.innerHTML = renderWindow();
      }
    } else {
      container.innerHTML = renderButton();
    }

    document.body.appendChild(container);

    // Attach event listeners
    attachEventListeners();
  }

  // Render button
  function renderButton() {
    const label = `Open ${config.widgetName || 'leasing'} chat`;
    return `
      <button
        class="ll-button"
        style="background: ${config.primaryColor}"
        onclick="lumaleasing('open')"
        aria-label="${escapeHtml(label)}"
        aria-haspopup="dialog"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3c5.5 0 10 3.58 10 8s-4.5 8-10 8c-1.24 0-2.43-.18-3.53-.5C5.55 21 2 21 2 21c2.33-2.33 2.7-3.9 2.75-4.5C3.05 15.07 2 13.13 2 11c0-4.42 4.5-8 10-8z"/></svg>
        <span class="ll-status ${config.isOnline ? 'online' : 'offline'}" aria-hidden="true"></span>
      </button>
    `;
  }

  // Render chat window
  function renderWindow() {
    const gradient = `linear-gradient(135deg, ${config.primaryColor}, ${config.secondaryColor})`;
    
    let messagesHtml = messages.map(function(msg) {
      if (msg.role === 'system') {
        return `
          <div class="ll-system">
            <div class="ll-system-bubble">${escapeHtml(msg.content)}</div>
          </div>
        `;
      }
      
      const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const avatarBg = msg.role === 'assistant' ? `background: ${config.primaryColor}` : '';
      const bubbleBg = msg.role === 'assistant' ? `background: ${gradient}` : '';
      const icon = msg.role === 'assistant' 
        ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 011 1v3a1 1 0 01-1 1h-1v1a2 2 0 01-2 2H5a2 2 0 01-2-2v-1H2a1 1 0 01-1-1v-3a1 1 0 011-1h1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2M7.5 13A2.5 2.5 0 005 15.5 2.5 2.5 0 007.5 18a2.5 2.5 0 002.5-2.5A2.5 2.5 0 007.5 13m9 0a2.5 2.5 0 00-2.5 2.5 2.5 2.5 0 002.5 2.5 2.5 2.5 0 002.5-2.5 2.5 2.5 0 00-2.5-2.5z"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4a4 4 0 014 4 4 4 0 01-4 4 4 4 0 01-4-4 4 4 0 014-4m0 10c4.42 0 8 1.79 8 4v2H4v-2c0-2.21 3.58-4 8-4z"/></svg>';
      
      return `
        <div class="ll-message ${msg.role}">
          <div class="ll-message-avatar" style="${avatarBg}">${icon}</div>
          <div class="ll-message-bubble" style="${bubbleBg}">
            ${escapeHtml(msg.content)}
            <div class="ll-message-time">${time}</div>
          </div>
        </div>
      `;
    }).join('');

    if (isTyping) {
      messagesHtml += `
        <div class="ll-message assistant">
          <div class="ll-message-avatar" style="background: ${config.primaryColor}">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 011 1v3a1 1 0 01-1 1h-1v1a2 2 0 01-2 2H5a2 2 0 01-2-2v-1H2a1 1 0 01-1-1v-3a1 1 0 011-1h1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2M7.5 13A2.5 2.5 0 005 15.5 2.5 2.5 0 007.5 18a2.5 2.5 0 002.5-2.5A2.5 2.5 0 007.5 13m9 0a2.5 2.5 0 00-2.5 2.5 2.5 2.5 0 002.5 2.5 2.5 2.5 0 002.5-2.5 2.5 2.5 0 00-2.5-2.5z"/></svg>
          </div>
          <div class="ll-typing">
            <div class="ll-typing-dot"></div>
            <div class="ll-typing-dot"></div>
            <div class="ll-typing-dot"></div>
          </div>
        </div>
      `;
    }

    return `
      <div
        class="ll-window"
        role="dialog"
        aria-modal="false"
        aria-labelledby="ll-dialog-title"
        aria-describedby="ll-dialog-status"
      >
        <div class="ll-header" style="background: ${gradient}">
          <div class="ll-header-info">
            <div class="ll-avatar${config.logoUrl ? ' ll-avatar-logo' : ''}">
              ${config.logoUrl
                ? `<img src="${config.logoUrl}" alt="" style="width:100%;height:100%;object-fit:contain">`
                : '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>'}
            </div>
            <div>
              <div class="ll-name" id="ll-dialog-title">${escapeHtml(config.widgetName)}</div>
              <div class="ll-status-text" id="ll-dialog-status">
                <span class="ll-status-dot ${config.isOnline ? 'online' : 'offline'}" aria-hidden="true"></span>
                ${config.isOnline ? 'Online' : 'Away'}
              </div>
            </div>
          </div>
          <button class="ll-close" onclick="lumaleasing('close')" aria-label="Close chat">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        <div
          class="ll-messages"
          id="ll-messages"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
        >${messagesHtml}</div>
        <div class="ll-input-area">
          <div class="ll-input-row">
            <input type="text" class="ll-input" id="ll-input" placeholder="Type a message..." ${isTyping ? 'disabled' : ''}>
            <button class="ll-send" id="ll-send" style="background: ${config.primaryColor}" ${isTyping ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            </button>
          </div>
          <div class="ll-powered">Powered by LumaLeasing</div>
        </div>
      </div>
    `;
  }

  // Escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Render calendar picker
  function renderCalendar() {
    const gradient = `linear-gradient(135deg, ${config.primaryColor}, ${config.secondaryColor})`;
    
    if (!calendarData || !calendarData.availableDates || calendarData.availableDates.length === 0) {
      return renderCalendarError('No available dates found. Please call us to schedule your tour.');
    }

    // If no date selected, show month view
    if (!selectedDate) {
      return renderMonthView();
    }

    // If date selected, show time picker
    return renderTimePicker();
  }

  // Render calendar error
  function renderCalendarError(errorMsg) {
    const gradient = `linear-gradient(135deg, ${config.primaryColor}, ${config.secondaryColor})`;
    return `
      <div class="ll-window">
        <div class="ll-header" style="background: ${gradient}">
          <div class="ll-header-info">
            <div class="ll-name">Schedule a Tour</div>
          </div>
          <button class="ll-close" onclick="lumaleasing('close')">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        <div class="ll-calendar-content">
          <div class="ll-error-message">
            <svg viewBox="0 0 24 24" style="width:48px;height:48px;fill:#f59e0b;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
            <p>${escapeHtml(errorMsg)}</p>
            <button class="ll-button-primary" onclick="window.lumaleasing_backToChat()" style="background: ${config.primaryColor}">
              Back to Chat
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // Render month view
  function renderMonthView() {
    const gradient = `linear-gradient(135deg, ${config.primaryColor}, ${config.secondaryColor})`;
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const viewDate = calendarViewDate || today;
    const currentMonth = viewDate.getMonth();
    const currentYear = viewDate.getFullYear();

    // Build calendar grid
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();

    let calendarGrid = '';
    let dayCounter = 1;

    // Add week day headers
    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    calendarGrid += '<div class="ll-calendar-weekdays">';
    weekDays.forEach(day => {
      calendarGrid += `<div class="ll-calendar-weekday">${day}</div>`;
    });
    calendarGrid += '</div>';

    calendarGrid += '<div class="ll-calendar-grid">';

    // Add empty cells for days before month starts
    for (let i = 0; i < startDayOfWeek; i++) {
      calendarGrid += '<div class="ll-calendar-day ll-calendar-day-empty"></div>';
    }

    // Add days of month
    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(currentYear, currentMonth, day);
      const dateStr = dateObj.toISOString().split('T')[0];
      const isAvailable = calendarData.availableDates.includes(dateStr);
      const isPast = dateObj.getTime() < todayStart;
      const isToday = dateObj.toDateString() === today.toDateString();

      let dayClass = 'll-calendar-day';
      if (isPast) dayClass += ' ll-calendar-day-past';
      else if (isAvailable) dayClass += ' ll-calendar-day-available';
      else dayClass += ' ll-calendar-day-unavailable';
      if (isToday) dayClass += ' ll-calendar-day-today';

      const clickHandler = isAvailable ? `window.lumaleasing_selectDate('${dateStr}')` : '';

      calendarGrid += `
        <div class="${dayClass}" ${clickHandler ? `onclick="${clickHandler}"` : ''}>
          ${day}
        </div>
      `;
    }

    calendarGrid += '</div>';

    return `
      <div class="ll-window">
        <div class="ll-header" style="background: ${gradient}">
          <div class="ll-header-info">
            <div class="ll-name">Schedule a Tour</div>
            <div class="ll-status-text">Select a date</div>
          </div>
          <button class="ll-close" onclick="window.lumaleasing_backToChat()">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        <div class="ll-calendar-content">
          <div class="ll-calendar-header">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
              <button class="ll-button-secondary" onclick="window.lumaleasing_prevMonth()" style="padding:6px 10px;">←</button>
              <h3 style="margin:0;">${new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(viewDate)}</h3>
              <button class="ll-button-secondary" onclick="window.lumaleasing_nextMonth()" style="padding:6px 10px;">→</button>
            </div>
            <p class="ll-calendar-subtitle">Select a day to see available times</p>
          </div>
          ${calendarGrid}
          <div class="ll-calendar-footer">
            <button class="ll-button-secondary" onclick="window.lumaleasing_backToChat()">
              ← Back to Chat
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // Render time picker for selected date
  function renderTimePicker() {
    const gradient = `linear-gradient(135deg, ${config.primaryColor}, ${config.secondaryColor})`;
    const slots = calendarData.slotsByDate[selectedDate] || [];
    const availableSlots = slots.filter(s => s.available);

    if (availableSlots.length === 0) {
      return renderCalendarError('No available times for this date. Please select another date.');
    }

    // Format date nicely
    const dateObj = new Date(selectedDate + 'T00:00:00');
    const formattedDate = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    let timeSlotsHtml = '';
    availableSlots.forEach(slot => {
      const [hours, minutes] = slot.time.split(':');
      const hour = parseInt(hours);
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const hour12 = hour % 12 || 12;
      const displayTime = `${hour12}:${minutes} ${ampm}`;

      timeSlotsHtml += `
        <button class="ll-time-slot" onclick="window.lumaleasing_selectTime('${slot.time}')" style="border-color: ${config.primaryColor}">
          ${displayTime}
        </button>
      `;
    });

    return `
      <div class="ll-window">
        <div class="ll-header" style="background: ${gradient}">
          <div class="ll-header-info">
            <div class="ll-name">Schedule a Tour</div>
            <div class="ll-status-text">Select a time</div>
          </div>
          <button class="ll-close" onclick="window.lumaleasing_backToChat()">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        <div class="ll-calendar-content">
          <div class="ll-calendar-header">
            <h3>${formattedDate}</h3>
            <p class="ll-calendar-subtitle">Choose your preferred time</p>
          </div>
          <div class="ll-time-slots">
            ${timeSlotsHtml}
          </div>
          <div class="ll-calendar-footer">
            <button class="ll-button-secondary" onclick="window.lumaleasing_backToDatePicker()">
              ← Pick Different Date
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // Render confirmation form
  function renderConfirmation() {
    const gradient = `linear-gradient(135deg, ${config.primaryColor}, ${config.secondaryColor})`;
    
    // Format selected date/time
    const dateObj = new Date(selectedDate + 'T00:00:00');
    const formattedDate = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    
    const [hours, minutes] = selectedTime.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    const displayTime = `${hour12}:${minutes} ${ampm}`;

    return `
      <div class="ll-window">
        <div class="ll-header" style="background: ${gradient}">
          <div class="ll-header-info">
            <div class="ll-name">Confirm Your Tour</div>
          </div>
          <button class="ll-close" onclick="window.lumaleasing_backToChat()">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        <div class="ll-calendar-content">
          <div class="ll-confirmation-summary">
            <div class="ll-confirmation-icon" style="background: ${config.primaryColor}20; color: ${config.primaryColor}">
              📅
            </div>
            <h3>${formattedDate}</h3>
            <p class="ll-confirmation-time">${displayTime}</p>
          </div>
          <form id="ll-booking-form" class="ll-booking-form" onsubmit="return false;">
            <div class="ll-form-group">
              <label>First Name *</label>
              <input type="text" id="ll-first-name" required value="${leadInfo.firstName || ''}" />
            </div>
            <div class="ll-form-group">
              <label>Last Name *</label>
              <input type="text" id="ll-last-name" required value="${leadInfo.lastName || ''}" />
            </div>
            <div class="ll-form-group">
              <label>Email *</label>
              <input type="email" id="ll-email" required value="${leadInfo.email || ''}" />
            </div>
            <div class="ll-form-group">
              <label>Phone</label>
              <input type="tel" id="ll-phone" value="${leadInfo.phone || ''}" />
            </div>
            <div class="ll-form-group">
              <label>Special Requests</label>
              <textarea id="ll-special-requests" rows="3" placeholder="Any specific things you'd like to see?"></textarea>
            </div>
            <div class="ll-form-actions">
              <button type="button" class="ll-button-secondary" onclick="window.lumaleasing_backToTimePicker()">
                ← Back
              </button>
              <button type="button" class="ll-button-primary" onclick="window.lumaleasing_confirmBooking()" style="background: ${config.primaryColor}">
                Confirm Tour
              </button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  // Attach event listeners
  function attachEventListeners() {
    const input = document.getElementById('ll-input');
    const send = document.getElementById('ll-send');
    const messagesContainer = document.getElementById('ll-messages');

    if (input) {
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
    }

    if (send) {
      send.addEventListener('click', sendMessage);
    }

    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }

  // Extract contact info from text
  function extractContactInfo(text) {
    const info = {};
    
    // Email pattern
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) info.email = emailMatch[0];
    
    // Phone pattern (various formats)
    const phoneMatch = text.match(/(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/);
    if (phoneMatch) info.phone = phoneMatch[0].replace(/[^\d+]/g, '');
    
    // Name pattern - look for "I'm [Name]" or "my name is [Name]" or just capitalized words before email
    const namePatterns = [
      /(?:i'm|im|i am|my name is|this is|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
      /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+[a-zA-Z0-9._%+-]+@/,
      /^([A-Z][a-z]+\s+[A-Z][a-z]+)/
    ];
    
    for (const pattern of namePatterns) {
      const nameMatch = text.match(pattern);
      if (nameMatch) {
        const nameParts = nameMatch[1].trim().split(/\s+/);
        info.first_name = nameParts[0];
        if (nameParts.length > 1) info.last_name = nameParts.slice(1).join(' ');
        break;
      }
    }
    
    return Object.keys(info).length > 0 ? info : null;
  }

  // Save lead to backend
  async function saveLead(info) {
    if (!info || !info.email) return null;
    
    try {
      const response = await fetch(getApiBase() + '/api/lumaleasing/lead', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': config.apiKey,
          'X-Visitor-ID': visitorId
        },
        body: JSON.stringify({
          leadInfo: info,
          sessionId: sessionId,
          conversationId: conversationId
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        leadCaptured = true;
        leadInfo = { ...leadInfo, ...info };
        console.log('LumaLeasing: Lead captured', data.leadId);
        return data.leadId;
      }
    } catch (error) {
      console.error('LumaLeasing: Failed to save lead', error);
    }
    return null;
  }

  // Detect tour intent in message
  function detectTourIntent(text) {
    const tourKeywords = [
      'tour', 'visit', 'see', 'showing', 'appointment', 'schedule', 
      'book', 'come by', 'stop by', 'check out', 'look at', 'view'
    ];
    const lowerText = text.toLowerCase();
    return tourKeywords.some(keyword => lowerText.includes(keyword));
  }

  // Fetch tour availability from Google Calendar
  async function fetchTourAvailability() {
    try {
      const response = await fetch(getApiBase() + '/api/lumaleasing/tours/availability?startDate=' + new Date().toISOString().split('T')[0], {
        headers: {
          'X-API-Key': config.apiKey,
        }
      });

      if (!response.ok) {
        const error = await response.json();
        if (error.fallback) {
          // Calendar not connected, show message
          return { error: error.message, fallback: true };
        }
        throw new Error('Failed to fetch availability');
      }

      return await response.json();
    } catch (error) {
      console.error('LumaLeasing: Failed to fetch tour availability', error);
      return { error: 'Unable to load calendar. Please try again or call us.', fallback: true };
    }
  }

  // Book a tour
  async function bookTour(date, time, contactInfo) {
    try {
      const response = await fetch(getApiBase() + '/api/lumaleasing/tours', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': config.apiKey,
          'X-Visitor-ID': visitorId
        },
        body: JSON.stringify({
          slotId: null, // Using direct date/time, not slot ID
          leadInfo: contactInfo,
          specialRequests: contactInfo.specialRequests,
          sessionId: sessionId,
          conversationId: conversationId,
          tourDate: date,
          tourTime: time,
        })
      });

      if (!response.ok) {
        let serverMessage = '';
        try {
          const errorData = await response.json();
          serverMessage = errorData.message || errorData.error || '';
        } catch (parseError) {
          // Non-JSON error response; fall through to generic message.
        }
        throw new Error(serverMessage || 'Booking failed');
      }

      const data = await response.json();
      leadCaptured = true;
      leadInfo = { ...leadInfo, ...contactInfo };
      
      // Return to chat mode with success message
      widgetMode = 'chat';
      messages.push({
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.message || 'Your tour is confirmed! We\'ve sent a confirmation email with calendar invite.',
        timestamp: new Date()
      });
      
      renderWidget();
      
      return data;
    } catch (error) {
      console.error('LumaLeasing: Tour booking failed', error);
      throw error;
    }
  }

  // Send message
  async function sendMessage() {
    const input = document.getElementById('ll-input');
    if (!input || !input.value.trim() || isTyping) return;

    const text = input.value.trim();
    input.value = '';

    // Enforce email capture before chat when configured.
    if (config.requireEmailBeforeChat && !leadCaptured && !leadInfo.email) {
      const requiredEmail = extractContactInfo(text);
      if (!requiredEmail || !requiredEmail.email) {
        messages.push({
          id: Date.now().toString(),
          role: 'assistant',
          content: config.leadCapturePrompt || 'Before we continue, could you share your email so our team can follow up with accurate pricing and availability?',
          timestamp: new Date()
        });
        renderWidget();
        return;
      }
    }

    // Check for tour intent FIRST
    if (detectTourIntent(text) && widgetMode === 'chat') {
      // Add user message
      messages.push({
        id: Date.now().toString(),
        role: 'user',
        content: text,
        timestamp: new Date()
      });

      // Add assistant response suggesting calendar
      messages.push({
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Great! I can help you schedule a tour. Let me show you our available times...',
        timestamp: new Date()
      });

      renderWidget();

      // Fetch availability and switch to calendar mode
      const availability = await fetchTourAvailability();
      
      if (availability.error) {
        // Show error in chat
        messages.push({
          id: (Date.now() + 2).toString(),
          role: 'assistant',
          content: availability.error,
          timestamp: new Date()
        });
        renderWidget();
        return;
      }

      // Switch to calendar mode
      calendarData = availability;
      widgetMode = 'calendar';
      calendarViewDate = new Date();
      renderWidget();
      return;
    }

    // Try to extract contact info from the message
    const extractedInfo = extractContactInfo(text);
    if (extractedInfo && !leadCaptured) {
      // Merge with any existing info
      Object.assign(leadInfo, extractedInfo);
      if (extractedInfo.email) {
        // Save lead immediately when we get an email
        saveLead(leadInfo);
      }
    }

    // Add user message
    messages.push({
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date()
    });

    isTyping = true;
    renderWidget();

    try {
      const response = await fetch(getApiBase() + '/api/lumaleasing/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': config.apiKey,
          'X-Visitor-ID': visitorId
        },
        body: JSON.stringify({
          messages: messages.filter(m => m.id !== 'welcome').map(m => ({
            role: m.role,
            content: m.content
          })),
          sessionId: sessionId,
          leadInfo: leadCaptured ? leadInfo : (extractedInfo || undefined)
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Chat request failed');
      }

      if (data.sessionId) setStoredSessionId(data.sessionId);
      if (data.conversationId) conversationId = data.conversationId;

      if (data.content) {
        messages.push({
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.content,
          timestamp: new Date()
        });
      }

      if (data.isHumanMode && data.waitingForHuman) {
        messages.push({
          id: (Date.now() + 2).toString(),
          role: 'system',
          content: 'A team member will respond shortly. Thanks for your patience!',
          timestamp: new Date()
        });
      }

      if (data.shouldPromptLeadCapture && data.leadCapturePrompt && !leadCaptured) {
        messages.push({
          id: (Date.now() + 3).toString(),
          role: 'assistant',
          content: data.leadCapturePrompt,
          timestamp: new Date()
        });
      }

    } catch (error) {
      console.error('LumaLeasing send error:', error);
      messages.push({
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "I'm having trouble connecting. Please try again!",
        timestamp: new Date()
      });
    } finally {
      isTyping = false;
      renderWidget();
    }
  }

  // Open widget
  function openWidget() {
    if (!config) {
      console.warn('LumaLeasing: Widget not initialized. Check API key and network.');
      return;
    }
    isOpen = true;
    renderWidget();
  }

  // Close widget
  function closeWidget() {
    isOpen = false;
    renderWidget();
  }

  // Destroy widget
  function destroyWidget() {
    const widget = document.getElementById('lumaleasing-widget');
    if (widget) widget.remove();
    const styles = document.getElementById('lumaleasing-styles');
    if (styles) styles.remove();
    config = null;
    messages = [];
  }

  // Calendar widget handlers (exposed globally for onclick handlers)
  window.lumaleasing_selectDate = function(dateStr) {
    selectedDate = dateStr;
    selectedTime = null;
    renderWidget();
  };

  window.lumaleasing_backToDatePicker = function() {
    selectedDate = null;
    selectedTime = null;
    renderWidget();
  };

  window.lumaleasing_prevMonth = function() {
    const base = calendarViewDate || new Date();
    calendarViewDate = new Date(base.getFullYear(), base.getMonth() - 1, 1);
    renderWidget();
  };

  window.lumaleasing_nextMonth = function() {
    const base = calendarViewDate || new Date();
    calendarViewDate = new Date(base.getFullYear(), base.getMonth() + 1, 1);
    renderWidget();
  };

  window.lumaleasing_selectTime = function(timeStr) {
    selectedTime = timeStr;
    widgetMode = 'confirmation';
    renderWidget();
  };

  window.lumaleasing_backToTimePicker = function() {
    widgetMode = 'calendar';
    renderWidget();
  };

  window.lumaleasing_backToChat = function() {
    widgetMode = 'chat';
    selectedDate = null;
    selectedTime = null;
    calendarData = null;
    calendarViewDate = null;
    renderWidget();
  };

  window.lumaleasing_confirmBooking = async function() {
    const firstName = document.getElementById('ll-first-name')?.value;
    const lastName = document.getElementById('ll-last-name')?.value;
    const email = document.getElementById('ll-email')?.value;
    const phone = document.getElementById('ll-phone')?.value;
    const specialRequests = document.getElementById('ll-special-requests')?.value;

    if (!firstName || !lastName || !email) {
      alert('Please fill in all required fields');
      return;
    }

    let button = null;
    try {
      button = document.querySelector('.ll-button-primary');
      if (button) {
        button.disabled = true;
        button.textContent = 'Booking...';
      }

      await bookTour(selectedDate, selectedTime, {
        first_name: firstName,
        last_name: lastName,
        email: email,
        phone: phone,
        specialRequests: specialRequests
      });

      // Success handled in bookTour function (returns to chat with message)
    } catch (error) {
      const detail = error && error.message && error.message !== 'Booking failed'
        ? ' (' + error.message + ')'
        : '';
      alert('Failed to book tour. Please try again or call us.' + detail);
      if (button) {
        button.disabled = false;
        button.textContent = 'Confirm Tour';
      }
    }
  };

  // Replace queue with handler
  window.lumaleasing = function() {
    handleCommand.apply(null, arguments);
  };

  // Process any queued commands
  processQueue();

})();

