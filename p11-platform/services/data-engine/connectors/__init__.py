"""
LLM Connectors for PropertyAudit execution
Ported from TypeScript connectors in apps/web/utils/propertyaudit/

Connectors:
- OpenAIConnector: Structured mode GEO extraction
- ClaudeConnector: Structured mode GEO extraction
- OpenAINaturalConnector: Two-phase natural mode with web search
- ClaudeNaturalConnector: Two-phase natural mode with web search
- GeminiNaturalConnector: Gemini v1 natural mode
- PerplexityNaturalConnector: Perplexity v1 natural mode
- GoogleProxyNaturalConnector: Google-grounded proxy natural mode
- CrossModelAnalyzer: Post-run analysis comparing OpenAI vs Claude results
"""

from .openai_connector import OpenAIConnector
from .claude_connector import ClaudeConnector
from .openai_natural_connector import OpenAINaturalConnector
from .claude_natural_connector import ClaudeNaturalConnector
from .v1_natural_connectors import GeminiNaturalConnector, PerplexityNaturalConnector, GoogleProxyNaturalConnector
from .cross_model_analyzer import CrossModelAnalyzer
from .evaluator import score_answer, aggregate_scores

__all__ = [
    'OpenAIConnector',
    'ClaudeConnector', 
    'OpenAINaturalConnector',
    'ClaudeNaturalConnector',
    'GeminiNaturalConnector',
    'PerplexityNaturalConnector',
    'GoogleProxyNaturalConnector',
    'CrossModelAnalyzer',
    'score_answer',
    'aggregate_scores'
]







