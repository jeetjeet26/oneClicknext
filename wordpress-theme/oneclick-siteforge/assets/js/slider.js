/**
 * Top Slides Block - Swiper.js Integration
 * Requires Swiper.js library
 */

document.addEventListener('DOMContentLoaded', function() {
  const sliders = document.querySelectorAll('.block-top-slides.swiper-container');

  sliders.forEach(function(sliderElement) {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const autoplay = sliderElement.dataset.autoplay === 'true' && !reducedMotion;

    const swiper = new Swiper(sliderElement, {
      loop: true,
      effect: 'fade',
      fadeEffect: {
        crossFade: true
      },
      autoplay: autoplay ? {
        delay: 5000,
        disableOnInteraction: true
      } : false,
      pagination: {
        el: sliderElement.querySelector('.swiper-pagination'),
        type: 'bullets',
        clickable: true
      },
      navigation: {
        nextEl: sliderElement.querySelector('.swiper-button-next'),
        prevEl: sliderElement.querySelector('.swiper-button-prev')
      },
      keyboard: {
        enabled: true
      },
      a11y: {
        enabled: true
      }
    });

    const autoplayToggle = sliderElement.querySelector('.swiper-autoplay-toggle');
    if (autoplayToggle) {
      if (!autoplay) {
        autoplayToggle.hidden = true;
      }
      autoplayToggle.addEventListener('click', function() {
        const paused = autoplayToggle.getAttribute('aria-pressed') === 'true';
        if (paused) {
          swiper.autoplay.start();
          autoplayToggle.textContent = 'Pause slideshow';
          autoplayToggle.setAttribute('aria-pressed', 'false');
        } else {
          swiper.autoplay.stop();
          autoplayToggle.textContent = 'Play slideshow';
          autoplayToggle.setAttribute('aria-pressed', 'true');
        }
      });
    }
  });
});
