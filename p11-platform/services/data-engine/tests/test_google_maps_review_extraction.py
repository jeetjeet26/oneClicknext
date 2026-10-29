from unittest.mock import MagicMock
from scrapers.google_places import GoogleMapsReviewScraper


def test_expands_review_before_reading_text_without_element_page_attribute():
    scraper = GoogleMapsReviewScraper.__new__(GoogleMapsReviewScraper)
    card = MagicMock()
    card.get_attribute.return_value = 'stable-google-id'
    name, stars, text, more = (MagicMock() for _ in range(4))
    name.inner_text.return_value = 'Reviewer'
    stars.get_attribute.return_value = '5 stars'
    text.inner_text.side_effect = ['Truncated …', 'The complete expanded review text.']
    card.query_selector.side_effect = lambda selector: {
        '.d4r55, span.d4r55': name, '.kvMYJc': stars,
        '.MyEned .wiI7pd': text, ' .MyEned button.w8nwRe[aria-expanded="false"]': more,
    }.get(selector)
    result = scraper._extract_review_data_sync(card, 'place')
    assert result['review_text'] == 'The complete expanded review text.'
    assert result['review_date'] is None
    more.click.assert_called_once()
    card.page.wait_for_timeout.assert_not_called()
