from scrapers.coordinator import ScrapingCoordinator


def test_immediate_property_pricing_refresh_is_retired_without_network_or_database():
    coordinator = object.__new__(ScrapingCoordinator)
    result = coordinator.refresh_property_from_website("synthetic-property")
    assert result["success"] is False
    assert result["code"] == "review_required"
