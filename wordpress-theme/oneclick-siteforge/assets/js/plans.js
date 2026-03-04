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

    // Load plans data
    loadPlans(dataSource, container, displayStyle);

    // Setup filter listeners
    if (filtersContainer) {
      setupFilters(filtersContainer, container);
    }
  });

  function loadPlans(dataSource, container, displayStyle) {
    const apiUrl = dataSource === 'yardi'
      ? window.oneClickPlansSettings.yardi_url
      : window.oneClickPlansSettings.rentcafe_url;

    if (!apiUrl) {
      container.innerHTML = '<p>API endpoint not configured.</p>';
      return;
    }

    // Simulate plan data loading
    // In production, this would fetch from the configured API
    const plans = generateMockPlans();

    renderPlans(plans, container, displayStyle);
  }

  function generateMockPlans() {
    return [
      {
        id: 1,
        name: 'Studio',
        bedrooms: 'Studio',
        bathrooms: '1',
        sqft: '550',
        price: '$1,200',
        image: null,
        features: ['In-Unit Washer/Dryer', 'Balcony', 'City Views'],
        family_friendly: false
      },
      {
        id: 2,
        name: 'One Bedroom',
        bedrooms: '1',
        bathrooms: '1',
        sqft: '750',
        price: '$1,500',
        image: null,
        features: ['In-Unit Washer/Dryer', 'Walk-in Closet', 'Stainless Steel Appliances'],
        family_friendly: false
      },
      {
        id: 3,
        name: 'Two Bedroom',
        bedrooms: '2',
        bathrooms: '2',
        sqft: '1,100',
        price: '$2,100',
        image: null,
        features: ['In-Unit Washer/Dryer', 'Dishwasher', 'Hardwood Floors'],
        family_friendly: true
      },
      {
        id: 4,
        name: 'Three Bedroom',
        bedrooms: '3',
        bathrooms: '2.5',
        sqft: '1,500',
        price: '$2,800',
        image: null,
        features: ['In-Unit Washer/Dryer', 'Concierge', 'Garage Parking'],
        family_friendly: true
      }
    ];
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
        html += '<td>' + plan.name + '</td>';
        html += '<td>' + plan.bedrooms + '</td>';
        html += '<td>' + plan.bathrooms + '</td>';
        html += '<td>' + plan.sqft + '</td>';
        html += '<td>' + plan.price + '</td>';
        html += '<td>' + plan.features.join(', ') + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    }

    container.innerHTML = html;
  }

  function createPlanCard(plan) {
    let html = '<div class="plan-card" data-bedrooms="' + plan.bedrooms + '" data-sqft="' + plan.sqft.replace(/,/g, '') + '" data-family="' + plan.family_friendly + '">';
    html += '<div class="plan-header">';
    html += '<h3>' + plan.name + '</h3>';
    html += '<div class="plan-price">' + plan.price + '</div>';
    html += '</div>';
    html += '<div class="plan-details">';
    html += '<p><strong>Bedrooms:</strong> ' + plan.bedrooms + '</p>';
    html += '<p><strong>Bathrooms:</strong> ' + plan.bathrooms + '</p>';
    html += '<p><strong>Square Footage:</strong> ' + plan.sqft + ' sq ft</p>';
    html += '</div>';
    html += '<div class="plan-features">';
    html += '<strong>Features:</strong>';
    html += '<ul>';
    plan.features.forEach(function(feature) {
      html += '<li>' + feature + '</li>';
    });
    html += '</ul>';
    html += '</div>';
    html += '<button class="btn btn-primary plan-inquire">Inquire Now</button>';
    html += '</div>';

    return html;
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
