/**
 * Gallery Block - GLightbox Integration
 * Requires GLightbox library
 */

document.addEventListener('DOMContentLoaded', function() {
  const galleries = document.querySelectorAll('.block-gallery .gallery-grid');

  galleries.forEach(function(gallery) {
    const galleryId = 'gallery-' + Math.random().toString(36).substr(2, 9);
    const items = gallery.querySelectorAll('a.gallery-item');

    items.forEach(function(item) {
      item.setAttribute('data-gallery', galleryId);
    });

    // Initialize GLightbox if library is loaded
    if (typeof GLightbox !== 'undefined') {
      GLightbox({
        selector: 'a[data-gallery="' + galleryId + '"]',
        touchNavigation: true,
        keyboardNavigation: true,
        closeOnOutsideClick: true,
        loop: true,
        autoplayVideos: true
      });
    }
  });
});
