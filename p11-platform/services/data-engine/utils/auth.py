"""
API Key Authentication for Data Engine Job Endpoints
Protects background job execution endpoints from unauthorized access
"""
import os
import secrets
from fastapi import HTTPException, Header, Request
from typing import Optional
import logging

logger = logging.getLogger(__name__)

# Get API key from environment
DATA_ENGINE_API_KEY = os.environ.get('DATA_ENGINE_API_KEY')

def verify_api_key(x_api_key: Optional[str] = Header(None)) -> str:
    """
    Dependency for verifying API key on protected endpoints.
    
    Usage:
        @app.post('/jobs/propertyaudit/run', dependencies=[Depends(verify_api_key)])
        async def run_propertyaudit(...)
    
    Raises:
        HTTPException: If API key is missing or invalid
    
    Returns:
        str: The validated API key
    """
    if not DATA_ENGINE_API_KEY:
        raise HTTPException(status_code=503, detail="Data Engine authentication is not configured")
    
    if not x_api_key:
        logger.error("❌ API key missing from request")
        raise HTTPException(
            status_code=401,
            detail="Missing API key. Include X-API-Key header.",
            headers={"WWW-Authenticate": "ApiKey"},
        )
    
    if not secrets.compare_digest(x_api_key.encode(), DATA_ENGINE_API_KEY.encode()):
        logger.error("❌ Invalid API key provided")
        raise HTTPException(
            status_code=403,
            detail="Invalid API key",
        )
    
    logger.debug("✅ API key validated")
    return x_api_key


def verify_service_key(authorization: Optional[str]) -> None:
    """Require a configured service key for Bearer-authenticated endpoints."""
    expected_key = os.environ.get("DATA_ENGINE_API_KEY")
    if not expected_key:
        raise HTTPException(status_code=503, detail="Data Engine authentication is not configured")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization")
    token = authorization.removeprefix("Bearer ")
    if not secrets.compare_digest(token.encode(), expected_key.encode()):
        raise HTTPException(status_code=401, detail="Invalid API key")


async def log_request_middleware(request: Request, call_next):
    """
    Middleware to log all requests with correlation IDs.
    """
    correlation_id = request.headers.get('X-Correlation-ID', 'unknown')
    logger.info(f"[{correlation_id}] {request.method} {request.url.path}")
    
    response = await call_next(request)
    
    # Add correlation ID to response headers
    response.headers['X-Correlation-ID'] = correlation_id
    
    return response





