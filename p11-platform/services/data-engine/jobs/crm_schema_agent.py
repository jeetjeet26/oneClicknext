"""
CRM Schema Discovery Agent
Uses Claude (native Anthropic SDK) to intelligently map TourSpark fields to CRM fields
"""

import os
import json
import logging
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, asdict
import anthropic

from connectors.crm_adapters.base import TOURSPARK_SCHEMA, CRMSchema

logger = logging.getLogger(__name__)


COMMON_FALLBACK_MAPPINGS = {
    'first_name': ['FirstName', 'first_name', 'fname', 'First_Name'],
    'last_name': ['LastName', 'last_name', 'lname', 'Last_Name'],
    'email': ['Email', 'email', 'EmailAddress', 'email_address'],
    'phone': ['Phone', 'phone', 'PhoneNumber', 'phone_number', 'CellPhone', 'MobilePhone'],
    'source': ['LeadSource', 'Source', 'lead_source', 'source'],
    'status': ['Status', 'status', 'LeadStatus', 'lead_status'],
    'move_in_date': ['MoveInDate', 'move_in_date', 'Move_In_Date', 'desired_move_in_date'],
    'bedrooms': ['Bedrooms', 'bedrooms', 'BedroomPreference', 'bedroom_preference'],
    'notes': ['Notes', 'Comments', 'Description', 'notes', 'comments'],
}


@dataclass
class FieldMapping:
    """A single field mapping with confidence"""
    tourspark_field: str
    crm_field: str
    confidence: int  # 0-100
    reasoning: str
    alternatives: List[str]


@dataclass
class MappingResult:
    """Result of AI schema discovery and mapping"""
    schema: Dict[str, Any]
    mappings: List[FieldMapping]
    agent_reasoning: str
    success: bool
    error: Optional[str] = None


class CRMSchemaAgent:
    """
    AI agent for CRM schema discovery and field mapping.
    Uses native Anthropic SDK (not smolagents) for simplicity.
    """
    
    def __init__(self):
        api_key = os.environ.get('ANTHROPIC_API_KEY')
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY environment variable not set")
        
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = os.environ.get('CRM_AGENT_MODEL', 'claude-sonnet-4-20250514')
    
    def discover_and_map(
        self, 
        crm_type: str, 
        crm_schema: Dict[str, Any],
        learned_patterns: Optional[List[Dict[str, Any]]] = None
    ) -> MappingResult:
        """
        Use Claude to analyze CRM schema and generate intelligent field mappings.
        
        Args:
            crm_type: Type of CRM ('yardi', 'realpage', 'salesforce', 'hubspot', 'lasso')
            crm_schema: Schema returned by CRM adapter's get_schema()
            learned_patterns: Optional previous mapping patterns from database
            
        Returns:
            MappingResult with field mappings and confidence scores
        """
        logger.info(f"[CRM Schema Agent] Starting discovery for {crm_type}")
        
        # Build the prompt
        prompt = self._build_mapping_prompt(crm_type, crm_schema, learned_patterns)
        
        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=4000,
                temperature=0.1,  # Low temperature for consistent mappings
                messages=[{
                    "role": "user",
                    "content": prompt
                }]
            )
            
            content = response.content[0].text
            logger.debug(f"[CRM Schema Agent] Raw response: {len(content)} chars")
            
            # Parse the JSON response
            mappings = self._parse_mapping_response(content, crm_schema)
            
            return MappingResult(
                schema=crm_schema,
                mappings=mappings,
                agent_reasoning=self._extract_reasoning(content),
                success=True
            )
            
        except anthropic.APIError as e:
            logger.error(f"[CRM Schema Agent] Anthropic API error: {e}")
            return MappingResult(
                schema=crm_schema,
                mappings=[],
                agent_reasoning="",
                success=False,
                error=f"API error: {str(e)}"
            )
        except Exception as e:
            logger.error(f"[CRM Schema Agent] Unexpected error: {e}", exc_info=True)
            return MappingResult(
                schema=crm_schema,
                mappings=[],
                agent_reasoning="",
                success=False,
                error=str(e)
            )
    
    def _build_mapping_prompt(
        self, 
        crm_type: str, 
        crm_schema: Dict[str, Any],
        learned_patterns: Optional[List[Dict[str, Any]]] = None
    ) -> str:
        """Build the prompt for Claude to generate field mappings."""
        
        # Extract fields from CRM schema
        crm_fields = []
        if 'objects' in crm_schema and crm_schema['objects']:
            for obj in crm_schema['objects']:
                crm_fields.extend(obj.get('fields', []))
        elif 'fields' in crm_schema:
            crm_fields = crm_schema['fields']
        
        # Format CRM fields for prompt
        crm_fields_str = json.dumps(crm_fields, indent=2)
        tourspark_fields_str = json.dumps(TOURSPARK_SCHEMA['fields'], indent=2)
        
        # Add learned patterns if available
        patterns_section = ""
        if learned_patterns:
            patterns_str = json.dumps(learned_patterns, indent=2)
            patterns_section = f"""
## Previous Mapping Patterns (Learn From These)
These patterns show what field mappings worked well for other {crm_type} integrations:
{patterns_str}

Use these to boost confidence for similar mappings.
"""
        
        prompt = f"""You are a CRM integration specialist. Your task is to create field mappings between TourSpark (our lead management system) and {crm_type}.

## TourSpark Source Fields
{tourspark_fields_str}

## {crm_type} Target Fields
{crm_fields_str}
{patterns_section}
## Instructions

1. For each TourSpark field, find the best matching {crm_type} field
2. Assign a confidence score (0-100) based on how certain you are
3. Provide reasoning for your choice
4. List alternatives if confidence is below 90

## Scoring Guidelines
- 95-100: Exact semantic match (e.g., "email" → "Email")
- 85-94: Strong match with minor naming differences (e.g., "phone" → "MobilePhone")
- 70-84: Reasonable match requiring assumption (e.g., "phone" → "WorkPhone" when multiple phone fields exist)
- 50-69: Weak match, likely needs user confirmation
- Below 50: Don't include mapping, let user decide

## Phone Field Rules
When multiple phone fields exist (CellPhone, WorkPhone, HomePhone, PhoneNumber):
- Prefer CellPhone or MobilePhone as primary phone mapping
- Provide alternatives for user to choose

## Response Format
Return ONLY valid JSON in this exact format:
{{
  "reasoning": "Brief explanation of your analysis approach",
  "mappings": [
    {{
      "tourspark_field": "first_name",
      "crm_field": "FirstName",
      "confidence": 98,
      "reasoning": "Exact semantic match for first name",
      "alternatives": []
    }},
    {{
      "tourspark_field": "phone",
      "crm_field": "CellPhone",
      "confidence": 75,
      "reasoning": "Multiple phone fields exist, chose CellPhone as most likely for leads",
      "alternatives": ["WorkPhone", "PhoneNumber"]
    }}
  ]
}}

Only include mappings with confidence >= 50. Return valid JSON only, no markdown code blocks."""

        return prompt
    
    def _parse_mapping_response(
        self, 
        response_text: str,
        crm_schema: Dict[str, Any]
    ) -> List[FieldMapping]:
        """Parse Claude's response into FieldMapping objects."""
        
        # Try to extract JSON from response
        try:
            # First, try direct parse
            data = json.loads(response_text)
        except json.JSONDecodeError:
            # Try to find JSON block in response
            import re
            json_match = re.search(r'\{[\s\S]*\}', response_text)
            if json_match:
                try:
                    data = json.loads(json_match.group(0))
                except json.JSONDecodeError:
                    logger.error("[CRM Schema Agent] Could not parse JSON from response")
                    return self._create_fallback_mappings(crm_schema)
            else:
                logger.error("[CRM Schema Agent] No JSON found in response")
                return self._create_fallback_mappings(crm_schema)
        
        # Convert to FieldMapping objects
        mappings = []
        for m in data.get('mappings', []):
            mappings.append(FieldMapping(
                tourspark_field=m.get('tourspark_field', ''),
                crm_field=m.get('crm_field', ''),
                confidence=m.get('confidence', 0),
                reasoning=m.get('reasoning', ''),
                alternatives=m.get('alternatives', [])
            ))
        
        return mappings
    
    def _extract_reasoning(self, response_text: str) -> str:
        """Extract the reasoning section from Claude's response."""
        try:
            data = json.loads(response_text)
            return data.get('reasoning', '')
        except:
            return ''
    
    def _create_fallback_mappings(self, crm_schema: Dict[str, Any]) -> List[FieldMapping]:
        """Create basic fallback mappings when AI fails."""
        return create_fallback_mappings(crm_schema)


def create_fallback_mappings(crm_schema: Dict[str, Any]) -> List[FieldMapping]:
    """Create basic field mappings without requiring an AI provider."""
    crm_fields = []
    if 'objects' in crm_schema and crm_schema['objects']:
        for obj in crm_schema['objects']:
            crm_fields.extend([f.get('name', '') for f in obj.get('fields', [])])
    elif 'fields' in crm_schema:
        crm_fields = [f.get('name', '') for f in crm_schema['fields']]

    crm_fields_lower = {f.lower(): f for f in crm_fields}

    mappings = []
    for ts_field, candidates in COMMON_FALLBACK_MAPPINGS.items():
        for candidate in candidates:
            if candidate.lower() in crm_fields_lower:
                mappings.append(FieldMapping(
                    tourspark_field=ts_field,
                    crm_field=crm_fields_lower[candidate.lower()],
                    confidence=70,
                    reasoning="Fallback mapping based on common field names",
                    alternatives=[]
                ))
                break

    return mappings


def get_tourspark_schema() -> Dict[str, Any]:
    """Return the TourSpark canonical schema for reference."""
    return TOURSPARK_SCHEMA

