/**
 * Points of Interest Map Block
 * Google Maps API Integration
 */

document.addEventListener('DOMContentLoaded', function() {
  const poiMaps = document.querySelectorAll('.block-poi .poi-map');

  poiMaps.forEach(function(mapElement) {
    const lat = parseFloat(mapElement.dataset.lat);
    const lng = parseFloat(mapElement.dataset.lng);
    const radius = parseFloat(mapElement.dataset.radius);
    const categories = JSON.parse(mapElement.dataset.categories || '[]');

    if (!lat || !lng || !categories.length) {
      return;
    }

    if (!window.oneClickSettings || !window.oneClickSettings.googleMapsApiKey) {
      mapElement.innerHTML = '<p>Google Maps API key not configured.</p>';
      return;
    }

    // API key is already loaded via wp_localize_script
    loadGoogleMapsAPI(mapElement, lat, lng, radius, categories);
  });

  function loadGoogleMapsAPI(mapElement, lat, lng, radius, categories) {
    const apiKey = window.oneClickSettings.googleMapsApiKey;
    const mapId = mapElement.id;

    const script = document.createElement('script');
    script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(apiKey) + '&libraries=places';
    script.async = true;
    script.defer = true;

    script.onload = function() {
      initPoiMap(mapElement, lat, lng, radius, categories);
    };

    script.onerror = function() {
      mapElement.innerHTML = '<p>Failed to load Google Maps.</p>';
    };

    document.head.appendChild(script);
  }

  function initPoiMap(mapElement, lat, lng, radius, categories) {
    const location = { lat: parseFloat(lat), lng: parseFloat(lng) };

    const map = new google.maps.Map(mapElement, {
      zoom: 14,
      center: location,
      mapTypeControl: true,
      fullscreenControl: true,
      streetViewControl: true
    });

    // Add property location marker
    new google.maps.Marker({
      position: location,
      map: map,
      title: 'Property Location',
      icon: 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png'
    });

    // Search for nearby places
    const placesService = new google.maps.places.PlacesService(map);

    const typeMap = {
      'restaurants': ['restaurant'],
      'shopping': ['shopping_mall', 'store', 'supermarket'],
      'entertainment': ['movie_theater', 'amusement_park', 'park', 'bowling_alley'],
      'transit': ['subway_station', 'bus_station', 'train_station']
    };

    const colors = {
      'restaurants': 'FF5733',
      'shopping': 'FFC300',
      'entertainment': 'DAF7A6',
      'transit': 'C70039'
    };

    categories.forEach(function(category) {
      const types = typeMap[category];
      if (!types || !types.length) return;

      const nearbyRequest = {
        location: location,
        radius: radius,
        type: types[0]
      };

      placesService.nearbySearch(nearbyRequest, function(results, status) {
        if (status === google.maps.places.PlacesServiceStatus.OK && results) {
          results.forEach(function(place) {
            const color = colors[category] || 'CCCCCC';
            new google.maps.Marker({
              position: place.geometry.location,
              map: map,
              title: place.name,
              icon: 'http://maps.google.com/mapfiles/ms/icons/' + color + '-dot.png'
            });
          });
        }
      });
    });
  }
});
