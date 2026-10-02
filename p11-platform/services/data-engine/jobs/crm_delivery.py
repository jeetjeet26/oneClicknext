"""One claimed CRM handoff. Provider writes never retry after an uncertain acknowledgment."""
from utils.delivery_guard import require_delivery_enabled
from utils.supabase_client import get_supabase_client

def rpc(name, args):
    data=get_supabase_client().rpc(name,args).execute().data
    if not isinstance(data,dict):raise RuntimeError("CRM delivery receipt was not confirmed")
    return data

def run_crm_handoff(handoff_id, adapter_factory):
    require_delivery_enabled()
    saved=rpc("claim_crm_handoff",{"p_handoff_id":handoff_id})
    if saved.get("state")!="claimed":return {"state":saved.get("state","unknown")}
    common={"p_handoff_id":handoff_id,"p_claim_id":saved["claimId"]}
    def finish(outcome,external_id=None,note_id=None):
        return rpc("finish_crm_handoff",{**common,"p_outcome":outcome,"p_external_id":external_id,"p_note_id":note_id})
    # Only the immutable database cutover record permits this existing write-only connection.
    contract=saved.get("deliveryContract", "qualified")
    public_registration=saved["platform"]=="lasso" and bool(saved["credentials"].get("client_id") and (saved["credentials"].get("project_id") or saved["credentials"].get("community_id")))
    existing=contract=="existing_lasso" and public_registration
    if contract not in ("qualified", "existing_lasso") or (contract=="existing_lasso" and not existing) or (public_registration and not existing):
        return finish("failed")
    try:
        adapter=adapter_factory(saved["platform"],saved["credentials"])
        if saved["kind"]=="lead" and not existing:
            if getattr(adapter,"contract_version",None)=="crm-exact-v1":adapter.validate_values(saved["payload"],saved["mapping"])
            source=saved["source"]
            from jobs.crm_reconciliation import inspect_destination
            match=inspect_destination(saved,lambda *_: adapter)
    except Exception:
        return finish("failed")
    if saved["kind"]=="lead" and not existing:
        if match.get("status") not in ("match","no_match"):return finish("failed")
        receipt=rpc("record_crm_handoff_search",{**common,"p_found":match["status"]=="match","p_external_id":match.get("externalId"),"p_match_type":match.get("matchType")})
        if receipt.get("state") not in ("saved","replayed"):return {"state":receipt.get("state","unknown")}
        if match["status"]=="match":return finish("linked",match["externalId"])
    require_delivery_enabled()
    intent=rpc("mark_crm_handoff_write",common)
    if intent.get("state")!="write_once":return {"state":intent.get("state","unknown")}
    # Never catch a failed DB acknowledgment here as a retryable provider operation.
    try:
        if saved["kind"]=="note":result=adapter.add_note(saved["externalId"],saved["payload"]["note"])
        else:result=adapter.create_lead(saved["payload"])
    except Exception:
        return finish("needs_reconciliation")
    if not result.success or not result.external_id or getattr(result,"confirmation","unverified")!="confirmed":
        return finish("needs_reconciliation", result.external_id if saved["kind"]=="lead" else saved.get("externalId"))
    if saved["kind"]=="note":return finish("note_added",saved["externalId"],result.external_id)
    return finish("created",result.external_id)
