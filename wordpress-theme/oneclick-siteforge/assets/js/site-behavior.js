(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var configuration = window.oneClickSiteConfiguration || {};
    var behavior = configuration.behavior || {};
    var motion = configuration.motion || {};
    var reductionQuery = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    var reducedMotionMode = motion.reducedMotion === 'disable' ? 'disable' : 'respect';
    var reducedMotion = reducedMotionMode === 'disable' ||
      (reductionQuery && reductionQuery.matches);

    document.documentElement.setAttribute('data-siteforge-reduced-motion', reducedMotion ? 'true' : 'false');
    document.documentElement.style.scrollBehavior =
      behavior.smoothScroll && !reducedMotion ? 'smooth' : 'auto';

    if (behavior.externalLinksNewTab) {
      document.querySelectorAll('a[href^="http"]').forEach(function (link) {
        if (link.hostname !== window.location.hostname) {
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
        }
      });
    }

    var presentationFields = [
      'containerMode',
      'alignment',
      'widthPreset',
      'spacingPreset',
      'typographyPreset',
      'motionPreset'
    ];
    var applyPresentation = function () {
      var width = window.innerWidth;
      var breakpoint = width < 768 ? 'mobile' : width < 1024 ? 'tablet' : width < 1440 ? 'desktop' : 'wide';
      document.querySelectorAll('[data-siteforge-presentation]').forEach(function (element) {
        var presentation;
        try {
          presentation = JSON.parse(element.getAttribute('data-siteforge-presentation') || '{}');
        } catch (_error) {
          return;
        }
        var override = presentation.breakpointOverrides && presentation.breakpointOverrides[breakpoint]
          ? presentation.breakpointOverrides[breakpoint]
          : {};
        presentationFields.forEach(function (field) {
          Array.prototype.slice.call(element.classList).forEach(function (className) {
            if (className.indexOf('presentation-effective-' + field + '-') === 0) {
              element.classList.remove(className);
            }
          });
          var value = override[field] || presentation[field];
          if (/^[a-z][a-z-]*$/.test(value || '')) {
            element.classList.add('presentation-effective-' + field + '-' + value);
          }
        });
      });
    };
    applyPresentation();
    window.addEventListener('resize', applyPresentation, { passive: true });

    var existingBackToTop = document.querySelector('.siteforge-back-to-top');
    if (existingBackToTop) existingBackToTop.remove();
    if (behavior.backToTop) {
      var backToTop = document.createElement('button');
      backToTop.type = 'button';
      backToTop.className = 'siteforge-back-to-top';
      backToTop.setAttribute('aria-label', 'Back to top');
      backToTop.textContent = '↑';
      var updateBackToTop = function () {
        backToTop.classList.toggle('is-visible', window.scrollY > 480);
      };
      backToTop.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
      });
      window.addEventListener('scroll', updateBackToTop, { passive: true });
      document.body.appendChild(backToTop);
      updateBackToTop();
    }

    var cookieConsent = ['disabled', 'informational', 'required'].indexOf(behavior.cookieConsent) >= 0
      ? behavior.cookieConsent
      : 'disabled';
    var existingNotice = document.querySelector('.siteforge-cookie-notice');
    if (existingNotice) existingNotice.remove();
    if (cookieConsent === 'informational') {
      var noticeKey = 'siteforge_cookie_notice_dismissed';
      var dismissed = false;
      try {
        dismissed = window.localStorage.getItem(noticeKey) === '1';
      } catch (_error) {
        dismissed = false;
      }
      if (!dismissed) {
        var notice = document.createElement('section');
        notice.className = 'siteforge-consent-banner siteforge-cookie-notice';
        notice.setAttribute('role', 'status');
        notice.setAttribute('aria-label', 'Cookie notice');
        var message = document.createElement('p');
        message.textContent = (window.oneClickAnalytics && window.oneClickAnalytics.consentText) ||
          'We use first-party analytics to understand website usage and improve your experience.';
        var actions = document.createElement('div');
        var dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.textContent = 'Dismiss';
        dismiss.addEventListener('click', function () {
          try {
            window.localStorage.setItem(noticeKey, '1');
          } catch (_error) {
            // The notice remains dismissible when storage is unavailable.
          }
          notice.remove();
        });
        actions.appendChild(dismiss);
        notice.appendChild(message);
        notice.appendChild(actions);
        document.body.appendChild(notice);
      }
    }

    var parentOrigin = null;
    try {
      var referrer = document.referrer ? new URL(document.referrer) : null;
      if (
        referrer &&
        (
          referrer.hostname === 'hellop11.com' ||
          referrer.hostname === 'www.hellop11.com' ||
          referrer.hostname.endsWith('.vercel.app')
        )
      ) {
        parentOrigin = referrer.origin;
      }
    } catch (_error) {
      parentOrigin = null;
    }
    if (window.parent !== window && parentOrigin) {
      var selectionEnabled = false;
      var selectedTarget = null;
      var pageResource = document.querySelector('[data-siteforge-resource^="page:"]');
      var pageSlug = pageResource
        ? pageResource.getAttribute('data-siteforge-resource').replace(/^page:/, '')
        : window.location.pathname.replace(/^\/|\/$/g, '') || 'home';
      window.addEventListener('message', function (event) {
        if (
          event.source !== window.parent ||
          event.origin !== parentOrigin ||
          !event.data ||
          event.data.type !== 'siteforge-editor:set-selection-mode'
        ) {
          return;
        }
        selectionEnabled = event.data.enabled === true;
        document.documentElement.setAttribute(
          'data-siteforge-editor-selection',
          selectionEnabled ? 'true' : 'false'
        );
        if (!selectionEnabled && selectedTarget) {
          selectedTarget.style.removeProperty('outline');
          selectedTarget.style.removeProperty('outline-offset');
          selectedTarget = null;
        }
      });
      var boundingBox = function (element) {
        var rect = element.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
          width: rect.width,
          height: rect.height
        };
      };
      var pseudoTargets = function (element, targetId, resourcePath) {
        return ['before', 'after'].flatMap(function (side) {
          var style = window.getComputedStyle(element, '::' + side);
          var content = style && style.content;
          if (!content || content === 'none' || content === 'normal' || content === '""') {
            return [];
          }
          return [{
            targetId: targetId + '::' + side,
            kind: 'pseudo',
            resourcePath: resourcePath,
            selector: '[data-siteforge-target-id="' + targetId + '"]::' + side,
            displayValue: content.replace(/^["']|["']$/g, '').slice(0, 2000),
            boundingBox: boundingBox(element),
            pseudo: side
          }];
        });
      };
      document.addEventListener('click', function (event) {
        if (!selectionEnabled) return;
        var target = event.target instanceof Element
          ? event.target.closest('[data-siteforge-target-id]')
          : null;
        if (!target) return;
        var targetId = target.getAttribute('data-siteforge-target-id');
        var targetKind = target.getAttribute('data-siteforge-target-kind');
        var resourcePath = null;
        try {
          resourcePath = JSON.parse(target.getAttribute('data-siteforge-resource-path') || 'null');
        } catch (_error) {
          resourcePath = null;
        }
        if (
          !targetId ||
          !targetKind ||
          !Array.isArray(resourcePath) ||
          resourcePath.length === 0 ||
          resourcePath.some(function (segment) {
            return !segment || typeof segment.kind !== 'string' || typeof segment.id !== 'string';
          })
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (selectedTarget && selectedTarget !== target) {
          selectedTarget.style.removeProperty('outline');
          selectedTarget.style.removeProperty('outline-offset');
        }
        selectedTarget = target;
        selectedTarget.style.outline = '3px solid #7C83F6';
        selectedTarget.style.outlineOffset = '-3px';
        var displayValue = target.getAttribute('data-siteforge-display-value') ||
          (target.textContent ? target.textContent.trim().slice(0, 2000) : '');
        var payload = {
          targetId: targetId,
          kind: targetKind,
          resourcePath: resourcePath,
          selector: '[data-siteforge-target-id="' + targetId + '"]',
          displayValue: displayValue,
          boundingBox: boundingBox(target),
          pseudo: null
        };
        window.parent.postMessage({
          type: 'siteforge-editor:target-selected',
          pageSlug: pageSlug,
          target: payload,
          virtualTargets: pseudoTargets(target, targetId, resourcePath)
        }, parentOrigin);
        var section = target.closest('[data-siteforge-section-id]');
        if (!section || !section.getAttribute('data-siteforge-section-id')) return;
        var heading = section.querySelector('h1, h2, h3, h4');
        window.parent.postMessage({
          type: 'siteforge-editor:section-selected',
          pageSlug: pageSlug,
          sectionId: section.getAttribute('data-siteforge-section-id'),
          blockType: section.getAttribute('data-siteforge-block') || undefined,
          label: heading && heading.textContent
            ? heading.textContent.trim().slice(0, 160)
            : section.getAttribute('aria-label') || section.getAttribute('data-siteforge-section-id')
        }, parentOrigin);
      }, true);
      window.parent.postMessage({
        type: 'siteforge-editor:ready',
        pageSlug: pageSlug
      }, parentOrigin);
    }

    // Reveal individual sections, never one page-height wrapper: a wrapper
    // taller than ~10x the viewport can never reach a fractional visibility
    // threshold (embedded editor previews clip the viewport further), which
    // left entire pages permanently at opacity 0.
    var revealTargets = Array.prototype.slice.call(
      document.querySelectorAll('.site-content [data-siteforge-section-id]')
    );
    if (!revealTargets.length) {
      revealTargets = Array.prototype.slice.call(
        document.querySelectorAll('.site-content > *')
      );
    }
    revealTargets.forEach(function (target) {
      target.setAttribute('data-siteforge-reveal', '');
    });
    var revealAll = function () {
      revealTargets.forEach(function (target) { target.classList.add('is-visible'); });
    };
    if (reducedMotion || motion.level === 'none' || motion.reveal === 'none' || !('IntersectionObserver' in window)) {
      revealAll();
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0 });
    revealTargets.forEach(function (target) { observer.observe(target); });
    // Failsafe: rendered content must never stay invisible. If the observer
    // is starved (tiny embedded viewports, browser quirks), reveal everything.
    window.setTimeout(revealAll, 4000);
  });
}());
