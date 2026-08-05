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

    var revealTargets = document.querySelectorAll('.site-content > *');
    revealTargets.forEach(function (target) {
      target.setAttribute('data-siteforge-reveal', '');
    });
    if (reducedMotion || motion.level === 'none' || motion.reveal === 'none' || !('IntersectionObserver' in window)) {
      revealTargets.forEach(function (target) { target.classList.add('is-visible'); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });
    revealTargets.forEach(function (target) { observer.observe(target); });
  });
}());
