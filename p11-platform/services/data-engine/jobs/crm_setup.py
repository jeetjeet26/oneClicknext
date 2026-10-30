"""Saved CRM setup reads. Schema-only AI suggestions; no lead writes, learned-pattern writes or activation."""
import re
from urllib.parse import urlsplit
from utils.supabase_client import get_supabase_client
from utils.crm_provider_http import get as crm_read
from jobs.crm_schema_agent import CRMSchemaAgent, create_fallback_mappings
from connectors.crm_adapters.base import TOURSPARK_SCHEMA
FIELD = re.compile(r"^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$")

def rpc(name, args):
    data = get_supabase_client().rpc(name, args).execute().data
    if not isinstance(data, dict):
        raise RuntimeError("CRM operation result was not confirmed")
    return data

def inspect_configuration(saved, adapter_factory):
    credentials = dict(saved["credentials"])
    credentials["timeout"] = 20
    # Salesforce's SDK receives only an official HTTPS instance URL. Other custom
    # provider endpoints use our DNS-pinned authenticated GET transport.
    if saved["platform"] == "salesforce":
        endpoint = urlsplit(credentials.get("instance_url", ""))
        host = (endpoint.hostname or "").lower()
        if endpoint.scheme != "https" or endpoint.username or endpoint.password or endpoint.port not in (None,443) or not host.endswith((".salesforce.com", ".force.com")):
            return {"status":"failed","messageCode":"salesforce_instance_required"}
    adapter = adapter_factory(saved["platform"], credentials)
    adapter.read_get = crm_read
    connection = adapter.test_connection()
    evidence_source = getattr(connection, "evidence_source", "unverified")
    result = {"status":"checked" if connection.success and evidence_source == "provider_response" else "limited" if connection.success else "failed",
        "connection":{"success":bool(connection.success),"evidenceSource":evidence_source,"apiVersion":str(connection.api_version or "")[:80]},
        "messageCode":"read_check_only" if connection.success else "connection_unconfirmed"}
    if not connection.success or saved["kind"] != "schema":
        return result
    schema = adapter.get_schema()
    fields = [{"name":f.name,"label":str(f.label)[:200],"type":str(getattr(f.type,"value",f.type)),"required":bool(f.required)}
        for f in schema.fields if FIELD.fullmatch(str(f.name))][:500]
    source = getattr(schema,"evidence_source","unverified")
    result["schema"] = {"objectName":str(schema.object_name)[:128],"evidenceSource":source,"fields":fields,"truncated":len(fields)!=len(schema.fields)}
    if source != "provider_response" or len(fields)!=len(schema.fields):
        result["status"] = "limited"
    # Send only field metadata to the model, never credentials or lead records.
    schema_input = {"objects":[{"fields":fields}]}
    mappings = create_fallback_mappings(schema_input)
    basis = "known_field_names"
    result["messageCode"] = "ai_mapping_unavailable"
    try:
        answer = CRMSchemaAgent().discover_and_map(saved["platform"], schema_input)
        if answer.success:
            mappings = answer.mappings
            basis = "ai"
            result["messageCode"] = "ai_mapping_suggested"
    except Exception:
        pass  # Retain discovery and clearly labelled fallback suggestions.
    source_names = {f["name"] for f in TOURSPARK_SCHEMA["fields"]}
    target_names = {f["name"] for f in fields}
    seen_sources, seen_targets = set(), set()
    suggestions = []
    for m in mappings:
        if (m.tourspark_field not in source_names or m.crm_field not in target_names
                or m.tourspark_field in seen_sources or m.crm_field in seen_targets
                or type(m.confidence) is not int or not 50 <= m.confidence <= 100):
            continue
        seen_sources.add(m.tourspark_field)
        seen_targets.add(m.crm_field)
        suggestions.append({"source":m.tourspark_field,"target":m.crm_field,"basis":basis,
            "confidence":m.confidence,"reasoning":str(m.reasoning)[:1000],
            "alternatives":[v for v in m.alternatives if isinstance(v,str) and v in target_names][:5]})
    result["suggestions"] = suggestions
    targets = set(saved.get("mapping",{}).values())
    result["mappingIssues"] = {"unknownTargets":sorted(targets-{f["name"] for f in fields}),"unmappedRequired":[f["name"] for f in fields if f["required"] and f["name"] not in targets],"schemaEvidence":source}
    return result

def run_setup_operation(operation_id, adapter_factory):
    saved = rpc("claim_crm_setup_operation", {"p_operation_id":operation_id})
    if saved.get("state") != "claimed":
        return {"state":saved.get("state","unknown")}
    try:
        result = inspect_configuration(saved, adapter_factory)
    except Exception:
        # Provider exceptions may contain tokens, URLs or client data. Retain a safe code.
        result = {"status":"failed","messageCode":"provider_check_unconfirmed"}
    outcome = rpc("finish_crm_setup_operation", {"p_operation_id":operation_id,"p_claim_id":saved["claimId"],"p_result":result})
    return {"state":outcome.get("state","unknown")}
