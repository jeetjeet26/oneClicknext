-- Read-only heuristic, returning aggregate counts only. A zero is not a
-- redaction certificate for free text or for records absent from this snapshot.
with recursive nodes(event_id,value)as(
 select id,jsonb_build_object('request',request,'before',before_state,'after',after_state,'result',result)
 from public.shared_action_events
 union all
 select n.event_id,c.value from nodes n cross join lateral(
  select value from jsonb_each(case when jsonb_typeof(n.value)='object'then n.value else'{}'::jsonb end)
  union all
  select value from jsonb_array_elements(case when jsonb_typeof(n.value)='array'then n.value else'[]'::jsonb end)
 )c
),sensitive_keys as(
 select distinct n.event_id from nodes n cross join lateral jsonb_object_keys(case when jsonb_typeof(n.value)='object'then n.value else'{}'::jsonb end)k(key)
 where lower(k.key)~'^(password|passwd|secret|client_secret|authorization|cookie|access_token|refresh_token|api_key|apikey|credit_card|card_number)$'
),token_values as(
 select distinct event_id from nodes where jsonb_typeof(value)='string'and(value#>>'{}')~'^(Bearer[[:space:]]+[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{20,}\.)'
)
select jsonb_build_object('capturedAt',clock_timestamp(),'events',(select count(*)from public.shared_action_events),
 'eventsWithSecretNamedFields',(select count(*)from sensitive_keys),'eventsWithTokenLikeValues',(select count(*)from token_values),
 'trainingEligible',(select count(*)from public.shared_action_events where training_eligible),
 'scope','Present local records only; heuristic does not certify free-text redaction or historical provider data')as audit;
