"""Conservative identity checks before legacy pricing writes.

A bedroom label is not a unique plan identifier when a capture contains several
plans with that label. Reject the batch before any price/history/alert writes;
never invent an identity from the price, which changes between observations.
"""
from typing import Any, Iterable


class AmbiguousUnitIdentity(ValueError):
    pass


def unit_key(label: str) -> str:
    key = ' '.join((label or '').split()).casefold()
    if not key:
        raise AmbiguousUnitIdentity('A floor plan is missing its name; review the source before importing prices.')
    return key


def unique_units(units: Iterable[Any]) -> list[Any]:
    result = {}
    fields = ('bedrooms', 'bathrooms', 'sqft_min', 'sqft_max', 'rent_min',
              'rent_max', 'deposit', 'available_count', 'move_in_specials')
    for unit in units:
        key = unit_key(unit.unit_type)
        previous = result.get(key)
        if previous is not None:
            if any(getattr(previous, field, None) != getattr(unit, field, None) for field in fields):
                raise AmbiguousUnitIdentity(
                    f'Multiple different floor plans use the name {unit.unit_type!r}. '
                    'No prices from this batch were imported. Review the source and use distinct plan names.'
                )
            continue  # An exact repeated observation adds no new information.
        result[key] = unit
    return list(result.values())


def existing_unit_index(rows: Iterable[dict]) -> dict[str, dict]:
    result = {}
    for row in rows:
        key = unit_key(row['unit_type'])
        if key in result:
            raise AmbiguousUnitIdentity(
                f'Multiple saved plans use the name {row["unit_type"]!r}. '
                'Resolve their identities before importing new prices.'
            )
        result[key] = row
    return result
