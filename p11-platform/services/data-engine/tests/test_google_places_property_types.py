from scrapers.google_places import GooglePlacesScraper


def test_for_sale_property_types_use_home_search_terms():
    scraper = GooglePlacesScraper.__new__(GooglePlacesScraper)

    assert scraper._search_keywords_for_type("townhome")[:3] == [
        "new townhomes",
        "townhomes for sale",
        "townhome community",
    ]
    assert scraper._search_keywords_for_type("master_planned")[:2] == [
        "master planned community",
        "new homes community",
    ]


def test_multifamily_property_types_keep_apartment_search_terms():
    scraper = GooglePlacesScraper.__new__(GooglePlacesScraper)

    assert scraper._search_keywords_for_type("multifamily")[:2] == [
        "apartment community",
        "apartments for rent",
    ]
