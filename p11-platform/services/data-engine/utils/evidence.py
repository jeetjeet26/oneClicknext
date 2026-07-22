"""
Evidence lineage helpers.

Every external fetch (website scrape, apartments.com refresh, brand
extraction) should record a row in `market_source_captures` so downstream
facts (prices, availability, specials, brand claims, content chunks) can
cite the capture they came from via their `capture_id` column.

Recording evidence must never break ingestion: failures are logged and the
caller receives None, in which case facts are stored without lineage
(the pre-existing behavior).
"""

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

SOURCE_TYPES = {'website', 'apartments_com', 'google_places', 'manual', 'other'}


def content_hash_for(content: Any) -> Optional[str]:
    """Stable md5 hash for captured content (str or repr-able object)."""
    if content is None:
        return None
    if not isinstance(content, str):
        content = repr(content)
    return hashlib.md5(content.encode('utf-8')).hexdigest()


def record_source_capture(
    supabase,
    *,
    property_id: str,
    source_type: str,
    competitor_id: Optional[str] = None,
    source_url: Optional[str] = None,
    content_hash: Optional[str] = None,
    status: str = 'captured',
    error_message: Optional[str] = None,
) -> Optional[str]:
    """
    Insert a market_source_captures row and return its id.

    Returns None (and logs) on any failure so ingestion continues without
    lineage rather than failing the scrape.
    """
    if source_type not in SOURCE_TYPES:
        source_type = 'other'

    try:
        result = supabase.table('market_source_captures').insert({
            'property_id': property_id,
            'competitor_id': competitor_id,
            'source_type': source_type,
            'source_url': source_url,
            'content_hash': content_hash,
            'status': status,
            'error_message': error_message,
            'captured_at': datetime.now(timezone.utc).isoformat(),
        }).execute()

        if result.data:
            return result.data[0]['id']
        return None
    except Exception as e:
        logger.warning(
            f"Failed to record source capture for competitor {competitor_id} "
            f"({source_type} {source_url}): {e}"
        )
        return None
