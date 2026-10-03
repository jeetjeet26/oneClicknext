"""Fail-closed delivery gate shared by CRM provider write entry points."""
import os
from fastapi import HTTPException


def require_delivery_enabled():
    if os.environ.get("OUTBOUND_DELIVERY_PAUSED", "").strip().lower() != "false":
        raise HTTPException(status_code=423, detail="Outbound delivery is paused pending operator review.")
