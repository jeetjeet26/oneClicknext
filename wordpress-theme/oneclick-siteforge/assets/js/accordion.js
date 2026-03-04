/**
 * Accordion Block - Expand/Collapse Functionality
 */

document.addEventListener('DOMContentLoaded', function() {
  const accordions = document.querySelectorAll('.block-accordion .accordion');

  accordions.forEach(function(accordion) {
    const buttons = accordion.querySelectorAll('.accordion-button');

    buttons.forEach(function(button) {
      button.addEventListener('click', function() {
        const isExpanded = button.getAttribute('aria-expanded') === 'true';
        const panelId = button.getAttribute('aria-controls');
        const panel = document.getElementById(panelId);

        if (!panel) return;

        if (isExpanded) {
          // Close panel
          button.setAttribute('aria-expanded', 'false');
          panel.setAttribute('hidden', '');
        } else {
          // Close other panels in the same accordion
          buttons.forEach(function(otherButton) {
            const otherPanelId = otherButton.getAttribute('aria-controls');
            const otherPanel = document.getElementById(otherPanelId);

            if (otherButton !== button && otherPanel) {
              otherButton.setAttribute('aria-expanded', 'false');
              otherPanel.setAttribute('hidden', '');
            }
          });

          // Open current panel
          button.setAttribute('aria-expanded', 'true');
          panel.removeAttribute('hidden');
        }
      });
    });

    // Allow keyboard navigation
    buttons.forEach(function(button) {
      button.addEventListener('keydown', function(e) {
        let focusButton = null;

        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          e.preventDefault();
          focusButton = button.nextElementSibling;
          if (!focusButton) {
            focusButton = buttons[0];
          }
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          e.preventDefault();
          focusButton = button.previousElementSibling;
          if (!focusButton) {
            focusButton = buttons[buttons.length - 1];
          }
        } else if (e.key === 'Home') {
          e.preventDefault();
          focusButton = buttons[0];
        } else if (e.key === 'End') {
          e.preventDefault();
          focusButton = buttons[buttons.length - 1];
        }

        if (focusButton && focusButton.classList && focusButton.classList.contains('accordion-button')) {
          focusButton.focus();
        }
      });
    });
  });
});
