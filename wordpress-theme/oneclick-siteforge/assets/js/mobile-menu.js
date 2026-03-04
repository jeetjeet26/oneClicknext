/**
 * Mobile Menu Toggle
 */

document.addEventListener('DOMContentLoaded', function() {
  const menuToggle = document.querySelector('.menu-toggle');
  const primaryMenu = document.querySelector('.primary-menu-container');

  if (!menuToggle || !primaryMenu) {
    return;
  }

  menuToggle.addEventListener('click', function() {
    primaryMenu.classList.toggle('expanded');

    const isExpanded = primaryMenu.classList.contains('expanded');
    menuToggle.setAttribute('aria-expanded', isExpanded);
  });

  // Close menu when a link is clicked
  const menuLinks = primaryMenu.querySelectorAll('a');
  menuLinks.forEach(function(link) {
    link.addEventListener('click', function() {
      primaryMenu.classList.remove('expanded');
      menuToggle.setAttribute('aria-expanded', false);
    });
  });

  // Close menu on escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && primaryMenu.classList.contains('expanded')) {
      primaryMenu.classList.remove('expanded');
      menuToggle.setAttribute('aria-expanded', false);
      menuToggle.focus();
    }
  });
});
