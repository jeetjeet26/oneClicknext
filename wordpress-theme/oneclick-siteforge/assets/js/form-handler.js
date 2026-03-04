/**
 * Form Block - Lead Capture Handler
 */

document.addEventListener('DOMContentLoaded', function() {
  const forms = document.querySelectorAll('.block-form .lead-form');

  forms.forEach(function(form) {
    form.addEventListener('submit', function(e) {
      e.preventDefault();

      const endpoint = form.dataset.endpoint;
      const formType = form.dataset.type;
      const redirectUrl = form.querySelector('[name="redirect_url"]')?.value;

      if (!endpoint) {
        showFormError(form, 'API endpoint not configured.');
        return;
      }

      // Collect form data
      const formData = new FormData(form);
      const data = Object.fromEntries(formData);

      // Add metadata
      data.form_type = formType;
      data.timestamp = new Date().toISOString();
      data.page_url = window.location.href;

      // Show loading state
      const submitButton = form.querySelector('button[type="submit"]');
      const originalText = submitButton.textContent;
      submitButton.disabled = true;
      submitButton.textContent = 'Sending...';

      // Submit form
      fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      })
        .then(function(response) {
          if (!response.ok) {
            throw new Error('Network response was not ok: ' + response.status);
          }
          return response.json();
        })
        .then(function(result) {
          showFormSuccess(form);
          form.reset();

          if (redirectUrl) {
            setTimeout(function() {
              window.location.href = redirectUrl;
            }, 2000);
          }
        })
        .catch(function(error) {
          console.error('Form submission error:', error);
          showFormError(form, 'An error occurred. Please try again later.');
        })
        .finally(function() {
          submitButton.disabled = false;
          submitButton.textContent = originalText;
        });
    });
  });

  function showFormSuccess(form) {
    const successMessage = form.querySelector('.form-success');
    const errorMessage = form.querySelector('.form-error');

    if (errorMessage) {
      errorMessage.style.display = 'none';
    }

    if (successMessage) {
      successMessage.style.display = 'block';
      successMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      // Auto-hide after 5 seconds
      setTimeout(function() {
        successMessage.style.display = 'none';
      }, 5000);
    }
  }

  function showFormError(form, message) {
    const errorMessage = form.querySelector('.form-error');
    const successMessage = form.querySelector('.form-success');

    if (successMessage) {
      successMessage.style.display = 'none';
    }

    if (errorMessage) {
      errorMessage.textContent = message;
      errorMessage.style.display = 'block';
      errorMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
});
