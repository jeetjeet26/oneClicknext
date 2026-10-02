"""Read-only destination recovery. A missing record never authorizes a second write."""
import re
from urllib.parse import urlsplit
from utils.crm_provider_http import get as crm_read
from jobs.crm_delivery import rpc

SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,256}$")

def normalized(field, value):
    if not isinstance(value, str):
        return ""
    if field == "email":
        return value.strip().casefold()
    return re.sub(r"[^0-9]", "", value)

def inspect_destination(saved, adapter_factory):
    if saved["kind"] != "lead":
        return {"status": "unsupported", "reason": "note_receipt_required"}
    credentials = dict(saved["credentials"])
    if saved["platform"] == "lasso" and credentials.get("client_id") and (credentials.get("project_id") or credentials.get("community_id")):
        return {"status": "unsupported", "reason": "destination_read_unavailable"}
    if saved["platform"] == "salesforce":
        endpoint = urlsplit(credentials.get("instance_url", ""))
        if endpoint.scheme != "https" or endpoint.username or endpoint.password or endpoint.port not in (None,443) or not (endpoint.hostname or "").lower().endswith((".salesforce.com", ".force.com")):
            return {"status": "unconfirmed", "reason": "instance_unverified"}
    credentials["timeout"] = 20
    adapter = adapter_factory(saved["platform"], credentials)
    adapter.read_get = crm_read
    source, mapping = saved["source"], saved["mapping"]
    adapter.read_fields = list(mapping.values())
    destination = saved.get("externalId")
    if not destination:
        found = set()
        for field in ("email", "phone"):
            if not normalized(field, source.get(field)):
                continue
            result = adapter.search_lead(source[field] if field == "email" else "", source[field] if field == "phone" else None)
            if result.error or result.found and not result.external_id:
                return {"status": "unconfirmed", "reason": "search_unconfirmed"}
            if result.found:
                found.add(str(result.external_id))
        if len(found) > 1:
            return {"status": "unconfirmed", "reason": "conflicting_destinations"}
        if not found:
            return {"status": "no_match", "reason": "absence_does_not_prove_failure"}
        destination = found.pop()
    if not isinstance(destination, str) or not SAFE_ID.fullmatch(destination):
        return {"status": "unconfirmed", "reason": "destination_id_unverified"}
    record = adapter.get_lead(destination)
    if not isinstance(record, dict):
        return {"status": "unconfirmed", "reason": "record_unconfirmed"}
    returned_id = record.get("id", record.get("Id"))
    if returned_id is not None and str(returned_id) != destination:
        return {"status": "unconfirmed", "reason": "destination_conflict"}
    observed, matches = {}, []
    for field in ("email", "phone"):
        target = mapping.get(field)
        value = record.get(target) if target else None
        expected, actual = normalized(field, source.get(field)), normalized(field, value)
        if expected and actual and expected != actual:
            return {"status": "unconfirmed", "reason": "contact_conflict"}
        if expected and actual and expected == actual:
            matches.append(field)
            observed[field] = str(value)[:500]
    if not matches:
        return {"status": "unconfirmed", "reason": "contact_not_verified"}
    return {"status": "match", "externalId": destination, "matchType": "both" if len(matches) == 2 else matches[0], "observedContact": observed, "basis": "provider_record_read", "originalWriteConfirmed": False}

def run_crm_reconciliation(check_id, adapter_factory):
    saved = rpc("claim_crm_reconciliation", {"p_check_id": check_id})
    if saved.get("state") != "claimed":
        return {"state": saved.get("state", "unknown")}
    try:
        result = inspect_destination(saved, adapter_factory)
    except Exception:
        result = {"status": "unconfirmed", "reason": "provider_read_unconfirmed"}
    # A failed receipt acknowledgment must not be recategorized as provider evidence.
    return rpc("finish_crm_reconciliation", {"p_check_id": check_id, "p_claim_id": saved["claimId"], "p_result": result})
