/**
 * Top Slides Block - Swiper.js Integration
 * Requires Swiper.js library
 */

document.addEventListener('DOMContentLoaded', function() {
  const sliders = document.querySelectorAll('.block-top-slides.swiper-container');

  sliders.forEach(function(sliderElement) {
    const autoplay = sliderElement.dataset.autoplay === 'true';

    const swiper = new Swiper(sliderElement, {
      loop: true,
      effect: 'fade',
      fadeEffect: {
        crossFade: true
      },
      autoplay: autoplay ? {
        delay: 5000,
        disableOnInteraction: false
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
  });
});
