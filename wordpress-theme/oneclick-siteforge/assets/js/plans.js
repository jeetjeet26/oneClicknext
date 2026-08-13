/**
 * Floor Plans Browser Block
 * Yardi/RentCafe API Integration
 */

document.addEventListener('DOMContentLoaded', function() {
  const plansSections = document.querySelectorAll('.block-plans-availability');

  plansSections.forEach(function(section) {
    const dataSource = section.dataset.source || 'yardi';
    const displayStyle = section.dataset.style || 'interactive';
    const filtersContainer = section.querySelector('.plans-filters');
    const container = section.querySelector('#plans-container');

    if (!container) return;

    if (dataSource === 'siteforge' || dataSource === 'manual') {
      const publishedRows = container.querySelectorAll('[data-floor-plan-row]');
      if (publishedRows.length === 0 && filtersContainer) {
        filtersContainer.hidden = true;
      }
      if (publishedRows.length > 0 && filtersContainer) {
        setupFilters(filtersContainer, container);
      }
      return;
    }

    // Load plans data
    loadPlans(dataSource, container, displayStyle);

    // Setup filter listeners
    if (filtersContainer) {
      setupFilters(filtersContainer, container);
    }
  });

  function renderUnavailable(container) {
    container.innerHTML = '<div class="plans-unavailable" role="status">' +
      '<h2>Floor-plan inventory unavailable</h2>' +
      '<p>Current pricing and availability cannot be verified. Please contact the property directly.</p>' +
      '</div>';
  }

  function loadPlans(dataSource, container, displayStyle) {
    const settings = window.oneClickPlansSettings || {};
    const apiUrl = dataSource === 'yardi'
      ? settings.yardi_url
      : settings.rentcafe_url;

    if (!apiUrl) {
      renderUnavailable(container);
      return;
    }

    fetch(apiUrl, { credentials: 'omit', headers: { Accept: 'application/json' } })
      .then(function(response) {
        if (!response.ok) throw new Error('inventory request failed');
        return response.json();
      })
      .then(function(payload) {
        const plans = Array.isArray(payload.rows) ? payload.rows : [];
        const capturedAt = Date.parse(payload.capturedAt || payload.captured_at || '');
        const maxAgeMs = 24 * 60 * 60 * 1000;
        const fresh = Number.isFinite(capturedAt) && Date.now() - capturedAt <= maxAgeMs &&
          plans.length > 0 && plans.every(function(plan) {
            const sourceAt = Date.parse(plan.sourceUpdatedAt || plan.source_updated_at || plan.effectiveAt || plan.effective_at || '');
            const expiresAt = plan.expiresAt || plan.expires_at;
            return Number.isFinite(sourceAt) && Date.now() - sourceAt <= maxAgeMs &&
              (!expiresAt || Date.parse(expiresAt) > Date.now()) &&
              plan.pricingHiddenReason !== 'stale_inventory';
          });
        if (!fresh) throw new Error('inventory is unavailable or stale');
        renderPlans(plans, container, displayStyle);
      })
      .catch(function() {
        renderUnavailable(container);
      });
  }

  function renderPlans(plans, container, displayStyle) {
    let html = '';

    if (displayStyle === 'interactive') {
      html += '<div class="plans-list">';
      plans.forEach(function(plan) {
        html += createPlanCard(plan);
      });
      html += '</div>';
    } else {
      html += '<table class="plans-table">';
      html += '<thead><tr><th>Plan</th><th>Bedrooms</th><th>Bathrooms</th><th>Sq Ft</th><th>Price</th><th>Features</th></tr></thead>';
      html += '<tbody>';
      plans.forEach(function(plan) {
        html += '<tr>';
        html += '<td>' + escapeHtml(plan.name) + '</td>';
        html += '<td>' + escapeHtml(plan.bedrooms) + '</td>';
        html += '<td>' + escapeHtml(plan.bathrooms) + '</td>';
        html += '<td>' + escapeHtml(plan.sqft || plan.sqftMin || '') + '</td>';
        html += '<td>' + escapeHtml(plan.price || plan.rentMin || '') + '</td>';
        html += '<td>' + escapeHtml(Array.isArray(plan.features) ? plan.features.join(', ') : '') + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    }

    container.innerHTML = html;
  }

  function createPlanCard(plan) {
    const sqft = String(plan.sqft || plan.sqftMax || plan.sqftMin || '');
    const price = plan.price || (plan.rentMin != null ? '$' + Number(plan.rentMin).toLocaleString() : '');
    const familyFriendly = plan.family_friendly === true || plan.familyFriendly === true;
    const availabilityUrl = safeHttpUrl(plan.availabilityUrl || plan.availability_url);
    let html = '<div class="plan-card" data-bedrooms="' + escapeHtml(plan.bedrooms) + '" data-sqft="' + escapeHtml(sqft.replace(/,/g, '')) + '" data-family="' + (familyFriendly ? 'true' : 'false') + '">';
    html += '<div class="plan-header">';
    html += '<h3>' + escapeHtml(plan.name) + '</h3>';
    if (price) html += '<div class="plan-price">' + escapeHtml(price) + '</div>';
    html += '</div>';
    html += '<div class="plan-details">';
    html += '<p><strong>Bedrooms:</strong> ' + escapeHtml(plan.bedrooms) + '</p>';
    if (plan.bathrooms != null) html += '<p><strong>Bathrooms:</strong> ' + escapeHtml(plan.bathrooms) + '</p>';
    if (sqft) html += '<p><strong>Square Footage:</strong> ' + escapeHtml(sqft) + ' sq ft</p>';
    html += '</div>';
    if (availabilityUrl) {
      html += '<a class="btn btn-primary" href="' + escapeHtml(availabilityUrl) + '">Check availability</a>';
    }
    html += '</div>';

    return html;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(character) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character];
    });
  }

  function safeHttpUrl(value) {
    if (!value) return '';
    try {
      const parsed = new URL(String(value), window.location.origin);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
        ? parsed.href
        : '';
    } catch (error) {
      return '';
    }
  }

  function setupFilters(filtersContainer, container) {
    const filterSelects = filtersContainer.querySelectorAll('.filter-select, .filter-range, .filter-checkbox');

    filterSelects.forEach(function(filter) {
      filter.addEventListener('change', function() {
        applyFilters(filtersContainer, container);
      });

      if (filter.classList.contains('filter-range')) {
        filter.addEventListener('input', function() {
          const display = filter.parentElement.querySelector('.sqft-display');
          if (display) {
            display.textContent = filter.value + ' - 3000';
          }
          applyFilters(filtersContainer, container);
        });
      }
    });
  }

  function applyFilters(filtersContainer, container) {
    const bedroomFilter = filtersContainer.querySelector('[data-filter="bedrooms"]')?.value || '';
    const sqftFilter = filtersContainer.querySelector('[data-filter="square_footage"]')?.value || '';
    const familyFilter = filtersContainer.querySelector('[data-filter="family_features"]')?.checked || false;

    const cards = container.querySelectorAll('.plan-card');

    cards.forEach(function(card) {
      let show = true;

      if (bedroomFilter && card.dataset.bedrooms !== bedroomFilter) {
        show = false;
      }

      if (sqftFilter && parseInt(card.dataset.sqft) > parseInt(sqftFilter)) {
        show = false;
      }

      if (familyFilter && card.dataset.family !== 'true') {
        show = false;
      }

      card.style.display = show ? 'block' : 'none';
    });
  }
});
