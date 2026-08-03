(function() {
  'use strict';

  const config = window.oneClickAnalytics || { consentMode: 'required', events: [] };
  const allowedEvents = new Set(config.events || []);
  const consentKey = 'siteforge_analytics_consent';
  const sessionKey = 'siteforge_analytics_session';
  const policyVersion = config.policyVersion || 'siteforge-consent-v1';
  const randomId = function(prefix) {
    return prefix + (window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : Date.now() + '-' + Math.random().toString(16).slice(2));
  };
  let sessionId = null;

  const consentRecord = function() {
    if (config.consentMode !== 'required') return 'not_required';
    try {
      const stored = JSON.parse(window.localStorage.getItem(consentKey) || 'null');
      return stored && stored.policyVersion === policyVersion ? stored : null;
    } catch (_error) {
      return null;
    }
  };
  const consentState = function() {
    if (config.consentMode !== 'required') return 'not_required';
    const record = consentRecord();
    return record ? record.state : 'unknown';
  };
  const hasConsent = function() {
    return consentState() === 'granted' || consentState() === 'not_required';
  };
  const campaign = function() {
    const params = new URLSearchParams(window.location.search);
    return {
      source: params.get('utm_source') || undefined,
      medium: params.get('utm_medium') || undefined,
      campaign: params.get('utm_campaign') || undefined,
      content: params.get('utm_content') || undefined,
      term: params.get('utm_term') || undefined
    };
  };
  const publishDataLayer = function(event, details) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: event,
      siteforge: Object.assign({ path: window.location.pathname }, details || {})
    });
  };
  const track = function(event, details) {
    if (!hasConsent() || !allowedEvents.has(event)) return;
    if (!sessionId) {
      sessionId = window.localStorage.getItem(sessionKey) || randomId('sf-session-');
      window.localStorage.setItem(sessionKey, sessionId);
    }
    publishDataLayer(event, details);
    if (!config.endpoint || !config.publicKey) return;
    fetch(config.endpoint, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        'X-SiteForge-Key': config.publicKey
      },
      body: JSON.stringify({
        eventType: event,
        idempotencyKey: randomId('telemetry-'),
        sessionId: sessionId,
        consentState: consentState(),
        pageUrl: window.location.href,
        referrer: document.referrer || undefined,
        occurredAt: new Date().toISOString(),
        campaign: campaign(),
        payload: Object.assign({}, details || {}, {
          consentEvidence: {
            policyVersion: policyVersion,
            decidedAt: consentRecord() && consentRecord().decidedAt,
            categories: consentRecord() && consentRecord().categories
          }
        })
      })
    }).catch(function() {
      // Telemetry is deliberately non-blocking for the customer journey.
    });
  };

  const showConsent = function() {
    const existing = document.querySelector('.siteforge-consent-banner');
    if (existing) existing.remove();
    if (config.consentMode === 'required') {
      const banner = document.createElement('section');
      banner.className = 'siteforge-consent-banner';
      banner.setAttribute('role', 'dialog');
      banner.setAttribute('aria-label', 'Analytics consent');
      banner.innerHTML =
        '<p>' + (config.consentText || 'We use first-party analytics to understand website usage and improve your experience.') + '</p>' +
        '<div><button type="button" data-consent="denied">Decline</button>' +
        '<button type="button" data-consent="granted">Allow analytics</button></div>';
      banner.addEventListener('click', function(event) {
        const button = event.target instanceof Element
          ? event.target.closest('[data-consent]')
          : null;
        if (!button) return;
        const choice = button.getAttribute('data-consent');
        const record = {
          policyVersion: policyVersion,
          state: choice,
          categories: { necessary: true, analytics: choice === 'granted' },
          decidedAt: new Date().toISOString()
        };
        window.localStorage.setItem(consentKey, JSON.stringify(record));
        banner.remove();
        document.dispatchEvent(new CustomEvent('siteforge:consent-changed', { detail: record }));
        if (choice === 'granted') track('page_view');
      });
      document.body.appendChild(banner);
    }
  };

  window.SiteForgeConsent = Object.freeze({
    open: showConsent,
    withdraw: function() {
      window.localStorage.removeItem(consentKey);
      window.localStorage.removeItem(sessionKey);
      sessionId = null;
      showConsent();
    },
    state: consentState
  });

  const start = function() {
    if (config.consentMode === 'required' && consentState() === 'unknown') {
      showConsent();
      return;
    }
    track('page_view');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else start();

  document.addEventListener('click', function(event) {
    const target = event.target instanceof Element ? event.target.closest('a,button') : null;
    if (!target) return;
    if (target.matches('.btn, [data-siteforge-cta]')) {
      track('cta_click', { label: (target.textContent || '').trim().slice(0, 120) });
    }
    if (target.matches('[data-floorplan], .floor-plan-card a')) {
      track('floorplan_view');
    }
    if (target.matches('[data-availability], [href*="availability"]')) {
      track('availability_click');
    }
  });

  document.addEventListener('focusin', function(event) {
    if (event.target instanceof Element && event.target.closest('form')) {
      const form = event.target.closest('form');
      if (form && form.dataset.siteforgeStarted !== 'true') {
        form.dataset.siteforgeStarted = 'true';
        track(form.matches('[data-form-type="tour"]') ? 'tour_start' : 'lead_start');
      }
    }
  });

  document.addEventListener('siteforge:conversion-confirmed', function(event) {
    const detail = event instanceof CustomEvent ? event.detail || {} : {};
    if (!hasConsent() || !allowedEvents.has(detail.event)) return;
    publishDataLayer(detail.event, {
      leadId: detail.leadId,
      tourId: detail.tourId,
      serverConfirmed: true
    });
  });
})();
