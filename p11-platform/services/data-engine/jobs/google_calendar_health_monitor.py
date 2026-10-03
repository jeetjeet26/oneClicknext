"""Calendar credential renewal. Uses the same bounded claim/save protocol as web requests.

No email is sent by this job. OAuth refresh acceptance is not calendar-event or
scope acceptance. Tokens that are not due are counted separately from refreshes.
"""
import asyncio
import math
import os
import sys
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx
from supabase import create_client


def db_client():
    return create_client(os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""))


def parse_expiry(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else None
    except (ValueError, TypeError, AttributeError):
        return None


async def refresh_token_if_needed(calendar_config, db=None, client=None):
    db = db or db_client()
    c = calendar_config
    expiry = parse_expiry(c.get("token_expires_at"))
    if c.get("token_status") in ("disconnected", "revoked", "refresh_unconfirmed") or not c.get("sync_enabled"):
        return {"status": "reconnect_required"}
    provider = c.get("provider") or "google"
    if provider not in ("google", "microsoft") or not isinstance(c.get("credential_version"), int):
        return {"status": "error", "error": "connection_invalid"}
    prefix = "MICROSOFT" if provider == "microsoft" else "GOOGLE"
    client_id, secret = os.environ.get(prefix + "_CLIENT_ID"), os.environ.get(prefix + "_CLIENT_SECRET")
    args = {"p_property_id": c["property_id"], "p_calendar_id": c["id"], "p_request_id": str(uuid4())}
    claim = db.rpc("claim_calendar_token_refresh", {**args, "p_version": c["credential_version"], "p_force": not (expiry and expiry > datetime.now(timezone.utc) + timedelta(hours=24)),
        "p_identity": {"provider": provider, "accountEmail": c.get("account_email") or c.get("google_email"),
            "calendarId": c.get("calendar_id") or "primary", "subject": c.get("provider_subject"), "tenant": c.get("tenant_id")}}).execute().data
    if not isinstance(claim, dict):
        return {"status": "error", "error": "claim_unconfirmed"}
    if claim.get("state") == "ready":
        if claim.get("permissionState") != "confirmed" or not claim.get("accessToken") or not claim.get("refreshToken") or not parse_expiry(claim.get("expiresAt")) or not isinstance(claim.get("version"), int):
            return {"status": "error", "error": "claim_unconfirmed"}
        return {"status": "not_due"}
    if claim.get("state") != "claimed" or not claim.get("refreshToken"):
        return {"status": claim.get("state", "error")}

    def finish(outcome, tokens=None):
        payload = {**args, "p_outcome": outcome, **({"p_tokens": tokens} if tokens else {})}
        for attempt in range(2):
            try:
                saved = db.rpc("finish_calendar_token_refresh", payload).execute().data
                if not isinstance(saved, dict) or not isinstance(saved.get("state"), str):
                    raise ValueError("save_unconfirmed")
                if saved["state"] == "saved":
                    if saved.get("permissionState") != "confirmed" or not saved.get("accessToken") or not saved.get("refreshToken") or not parse_expiry(saved.get("expiresAt")) or not isinstance(saved.get("version"), int):
                        raise ValueError("save_unconfirmed")
                    return {"status": "refreshed"}
                return {"status": saved["state"]}
            except Exception:
                if attempt == 1:
                    return {"status": "error", "error": "save_unconfirmed"}

    if not client_id or not secret:
        finish("temporary_failure")
        return {"status": "error", "error": "authorization_not_configured"}

    endpoint = ("https://login.microsoftonline.com/" + (os.environ.get("MICROSOFT_TENANT_ID") or "organizations") + "/oauth2/v2.0/token") if provider == "microsoft" else "https://oauth2.googleapis.com/token"
    async def exchange(http):
        try:
            response = await http.post(endpoint, data={"client_id": client_id, "client_secret": secret, "grant_type": "refresh_token", "refresh_token": claim["refreshToken"]}, timeout=20)
        except Exception:
            return finish("unconfirmed")
        try:
            payload = response.json()
        except (ValueError, TypeError):
            payload = None
        if not response.is_success:
            return finish("revoked" if isinstance(payload, dict) and payload.get("error") == "invalid_grant" else "temporary_failure")
        if not isinstance(payload, dict):
            return finish("unconfirmed")
        access, refresh, expires = payload.get("access_token"), payload.get("refresh_token"), payload.get("expires_in")
        if not isinstance(access, str) or not access.strip() or any(c.isspace() for c in access) or len(access) > 16384 or type(expires) not in (int, float) or not math.isfinite(expires) or not 0 < expires <= 366 * 86400 or ("refresh_token" in payload and (not isinstance(refresh, str) or not refresh.strip() or any(c.isspace() for c in refresh) or len(refresh) > 16384)) or ("token_type" in payload and str(payload["token_type"]).lower() != "bearer"):
            return finish("unconfirmed")
        tokens = {"accessToken": access, "expiresAt": (datetime.now(timezone.utc) + timedelta(seconds=expires)).isoformat()}
        if "scope" in payload:
            scope = payload["scope"]
            tokens["scope"] = scope if isinstance(scope, str) and len(scope) <= 16384 else None
        if "refresh_token" in payload:
            tokens["refreshToken"] = refresh
        return finish("success", tokens)

    if client is not None:
        return await exchange(client)
    async with httpx.AsyncClient() as http:
        return await exchange(http)


async def monitor_all_calendars(db=None):
    db = db or db_client()
    response = db.table("agent_calendars").select("*").eq("sync_enabled", True).execute()
    if response.data is None:
        raise RuntimeError("Calendar list could not be confirmed")
    results = {"refreshed": 0, "not_due": 0, "busy": 0, "reconnect_required": 0, "errors": 0}
    for calendar in response.data:
        try:
            outcome = await refresh_token_if_needed(calendar, db=db)
            status = outcome["status"]
            if status in ("refreshed", "not_due", "busy"):
                results[status] += 1
            elif status in ("revoked", "review", "refresh_unconfirmed", "reconnect_required", "permissions_unconfirmed", "permissions_incomplete"):
                results["reconnect_required"] += 1
            else:
                results["errors"] += 1
        except Exception:
            results["errors"] += 1
    # Counts only. Neither credentials nor raw provider responses enter logs.
    print(f"[CalendarHealth] {results}")
    return results


def main():
    try:
        results = asyncio.run(monitor_all_calendars())
        return 1 if results["errors"] or results["reconnect_required"] else 0
    except Exception:
        print("[CalendarHealth] Check could not be completed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
