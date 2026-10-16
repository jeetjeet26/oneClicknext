-- Preserve conservative admission while charging completed calls by the exact
-- provider usage already retained in immutable model evidence.
-- Keep historical intents untouched; future inserts capture the same transaction
-- day used by claim_luma_model, even when the transaction crosses UTC midnight.
alter table public.luma_model_intents add column reservation_bucket text;
alter table public.luma_model_intents alter column reservation_bucket set default
 ('ai:'||to_char(now()at time zone'UTC','YYYY-MM-DD'));

create table public.luma_model_allowance_settlements(
 model_id uuid primary key references public.luma_model_intents(id),
 property_id uuid not null references public.properties(id),
 bucket text not null,
 reserved_units bigint not null check(reserved_units>0),
 charged_units bigint not null check(charged_units>0),
 released_units bigint not null,
 allowance_before bigint not null,
 allowance_after bigint not null check(allowance_after>=0),
 response_hash text not null check(response_hash~'^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 check(released_units=reserved_units-charged_units),
 check(allowance_after=allowance_before-released_units)
);
create index luma_model_allowance_settlements_property_bucket on public.luma_model_allowance_settlements(property_id,bucket);
alter table public.luma_model_allowance_settlements enable row level security;
revoke all on public.luma_model_allowance_settlements from public,anon,authenticated,community_brain_worker,service_role;
grant select on public.luma_model_allowance_settlements to service_role;
create trigger recorded_luma_allowance_settlement before insert or update or delete on public.luma_model_allowance_settlements
 for each row execute function public.guard_luma_request_evidence();

create function public.settle_luma_model_allowance(p_property_id uuid,p_model_id uuid,p_reviewed_bucket text default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare intent public.luma_model_intents;receipt public.luma_model_results;prior public.luma_model_allowance_settlements;
 usage jsonb;total bigint;prompt_units bigint;completion_units bigint;bucket_name text;before_units bigint;after_units bigint;
 previous_scope text:=current_setting('p11.luma_request_scope',true);
begin
 select *into intent from public.luma_model_intents where id=p_model_id and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 select *into prior from public.luma_model_allowance_settlements where model_id=intent.id;
 if found then return jsonb_build_object('state','replayed','releasedUnits',prior.released_units,'chargedUnits',prior.charged_units);end if;
 select *into receipt from public.luma_model_results where id=intent.id and property_id=p_property_id;
 if not found or receipt.outcome<>'received' or nullif(receipt.response->>'id','')is null then return '{"state":"usage_unconfirmed"}';end if;
 usage:=receipt.response->'usage';
 if jsonb_typeof(usage->'total_tokens')is distinct from 'number'
  or jsonb_typeof(usage->'prompt_tokens')is distinct from 'number'
  or jsonb_typeof(usage->'completion_tokens')is distinct from 'number'
  or (usage->>'total_tokens')!~'^[0-9]{1,12}$'
  or (usage->>'prompt_tokens')!~'^[0-9]{1,12}$'
  or (usage->>'completion_tokens')!~'^[0-9]{1,12}$' then return '{"state":"usage_unconfirmed"}';end if;
 total:=(usage->>'total_tokens')::bigint;prompt_units:=(usage->>'prompt_tokens')::bigint;completion_units:=(usage->>'completion_tokens')::bigint;
 if total<=0 or total<>prompt_units+completion_units then return '{"state":"usage_unconfirmed"}';end if;
 bucket_name:=intent.reservation_bucket;
 -- Old receipts need a separately reviewed reservation day. Do not infer or
 -- automatically credit historical calls from their later insertion timestamp.
 if bucket_name is null then
  if p_reviewed_bucket is null or p_reviewed_bucket !~ '^ai:[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   then return '{"state":"reservation_day_unconfirmed"}';end if;
  bucket_name:=p_reviewed_bucket;
 elsif p_reviewed_bucket is not null and p_reviewed_bucket<>bucket_name then
  return '{"state":"reservation_day_conflict"}';
 end if;
 select used into before_units from public.luma_allowances where property_id=p_property_id and bucket=bucket_name for update;
 if not found then return '{"state":"allowance_unconfirmed"}';end if;
 after_units:=before_units-intent.reserved_units+total;
 if after_units<0 then return '{"state":"allowance_unconfirmed"}';end if;
 perform set_config('p11.luma_request_scope',p_property_id::text,true);
 insert into public.luma_model_allowance_settlements(model_id,property_id,bucket,reserved_units,charged_units,released_units,allowance_before,allowance_after,response_hash)
 values(intent.id,p_property_id,bucket_name,intent.reserved_units,total,intent.reserved_units-total,before_units,after_units,encode(sha256(convert_to(receipt.response::text,'UTF8')),'hex'));
 update public.luma_allowances set used=after_units where property_id=p_property_id and bucket=bucket_name;
 perform set_config('p11.luma_request_scope',coalesce(previous_scope,''),true);
 return jsonb_build_object('state','settled','releasedUnits',intent.reserved_units-total,'chargedUnits',total);
end $$;
revoke all on function public.settle_luma_model_allowance(uuid,uuid,text) from public,anon,authenticated,community_brain_worker;
grant execute on function public.settle_luma_model_allowance(uuid,uuid,text) to service_role;

create function public.settle_luma_model_result()returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform public.settle_luma_model_allowance(new.property_id,new.id);
 return new;
end $$;
revoke all on function public.settle_luma_model_result() from public,anon,authenticated,community_brain_worker;
create trigger settle_recorded_luma_usage after insert on public.luma_model_results for each row execute function public.settle_luma_model_result();
