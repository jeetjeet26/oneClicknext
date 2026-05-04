"""
CRM Adapters Package
Provides unified interface for various CRM/PMS systems
"""

from .base import BaseCRMAdapter, CRMSchema, CRMField, TOURSPARK_SCHEMA
from .yardi_adapter import YardiAdapter
from .realpage_adapter import RealPageAdapter
from .salesforce_adapter import SalesforceAdapter
from .hubspot_adapter import HubSpotAdapter
from .lasso_adapter import LassoAdapter

__all__ = [
    'BaseCRMAdapter', 
    'CRMSchema', 
    'CRMField',
    'TOURSPARK_SCHEMA',
    'YardiAdapter',
    'RealPageAdapter',
    'SalesforceAdapter',
    'HubSpotAdapter',
    'LassoAdapter',
]

