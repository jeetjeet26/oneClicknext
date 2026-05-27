from routers.competitor_intake import _build_kb_content, _parse_location


def test_parse_location_extracts_city_state_zip():
    assert _parse_location("El Monte, CA 91733") == {
        "city": "El Monte",
        "state": "CA",
        "zip": "91733",
    }


def test_build_kb_content_uses_enriched_evidence():
    content = _build_kb_content(
        competitor={
            "name": "Brookhaven",
            "website_url": "https://example.com",
            "address": "El Monte, CA",
        },
        brand={
            "positioning_statement": "New townhomes with smart-home technology.",
            "target_audience": "Homebuyers in San Gabriel Valley",
            "brand_voice": "family-friendly",
            "unique_selling_points": ["No Mello Roos"],
            "confidence_score": 0.9,
        },
        units=[
            {
                "unit_type": "Plan 1",
                "bedrooms": 2,
                "sqft_min": 1250,
                "sqft_max": 1594,
                "rent_min": 694990,
                "rent_max": None,
            }
        ],
        evidence={"source": "google_places"},
    )

    assert "Competitor: Brookhaven" in content
    assert "Positioning: New townhomes with smart-home technology." in content
    assert "Unique selling points: No Mello Roos" in content
