(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var configuration = window.oneClickSiteConfiguration || {};
    var behavior = configuration.behavior || {};
    var motion = configuration.motion || {};

    if (behavior.smoothScroll) {
      document.documentElement.style.scrollBehavior = 'smooth';
    }

    if (behavior.externalLinksNewTab) {
      document.querySelectorAll('a[href^="http"]').forEach(function (link) {
        if (link.hostname !== window.location.hostname) {
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
        }
      });
    }

    var revealTargets = document.querySelectorAll('.site-content > *');
    revealTargets.forEach(function (target) {
      target.setAttribute('data-siteforge-reveal', '');
    });
    if (motion.level === 'none' || motion.reveal === 'none' || !('IntersectionObserver' in window)) {
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
