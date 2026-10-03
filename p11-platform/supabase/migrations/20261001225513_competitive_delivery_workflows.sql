-- Property-scoped delivery, reported leasing outcomes and reviewed client reports.
-- Existing products retain all authority over provider execution.
create table public.delivery_outcomes (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
 property_id uuid not null references public.properties(id), lead_id uuid not null references public.leads(id),
 stage text not null check(stage in('booked','attended','application','lease')),
 occurred_on date not null, source text not null check(source in('staff_reported','reviewed_import')),
 reference text not null check(length(reference) between 3 and 500),
 state text not null default 'active' check(state in('active','withdrawn')),
 revision integer not null default 1 check(revision>0), updated_by uuid not null,
 updated_at timestamptz not null default clock_timestamp(), unique(property_id,lead_id,stage)
);
create index delivery_outcomes_scope on public.delivery_outcomes(org_id,property_id,occurred_on);
create index delivery_outcomes_lead on public.delivery_outcomes(lead_id);
create table public.delivery_work (
 id uuid primary key, org_id uuid not null references public.organizations(id),
 property_id uuid not null references public.properties(id), title text not null check(length(title) between 3 and 160),
 product text not null check(product in('siteforge','propertyaudit','bi','tourspark','lumaleasing','leadpulse','crm','forgestudio','reviewflow','marketvision','brandforge','property','knowledge')),
 playbook text not null check(playbook in('custom','website_improvement','onboarding','monthly_review','rebrand')),
 owner_id uuid not null, due_on date not null, status text not null default 'draft' check(status in('draft','review','approved','released','measured','blocked','cancelled')),
 next_step text not null check(length(next_step) between 3 and 1000),
 proposal text not null default '' check(length(proposal)<=4000),
 client_summary text not null default '' check(length(client_summary)<=2000),
 baseline_event uuid references public.shared_action_events(id), release_event uuid references public.shared_action_events(id), measurement_event uuid references public.shared_action_events(id),
 approved_by uuid, approved_at timestamptz, released_at timestamptz, measured_at timestamptz,
 revision integer not null default 1 check(revision>0), created_by uuid not null,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create index delivery_work_scope on public.delivery_work(org_id,property_id,updated_at desc,id);
create index delivery_work_property on public.delivery_work(property_id);
create index delivery_work_owner on public.delivery_work(owner_id);
create index delivery_work_baseline on public.delivery_work(baseline_event);
create index delivery_work_release on public.delivery_work(release_event);
create index delivery_work_measurement on public.delivery_work(measurement_event);
create table public.delivery_quality (
 id uuid primary key, org_id uuid not null references public.organizations(id), property_id uuid not null references public.properties(id),
 work_id uuid not null references public.delivery_work(id), work_revision integer not null, evidence_id uuid not null references public.shared_action_events(id),
 actor_id uuid not null, assessment jsonb not null check(jsonb_typeof(assessment)='object'), created_at timestamptz not null default clock_timestamp()
);
create index delivery_quality_scope on public.delivery_quality(org_id,property_id,created_at desc,id);
create index delivery_quality_property on public.delivery_quality(property_id);
create index delivery_quality_work on public.delivery_quality(work_id);
create index delivery_quality_evidence on public.delivery_quality(evidence_id);
create table public.delivery_reports (
 id uuid primary key references public.bi_reports(id), source_report_id uuid not null references public.bi_reports(id), org_id uuid not null references public.organizations(id), property_id uuid not null references public.properties(id),
 month date not null check(extract(day from month)=1), state text not null default 'draft' check(state in('draft','approved','published','withdrawn')),
 summary text not null default '' check(length(summary)<=4000), next_steps text not null default '' check(length(next_steps)<=2000),
 evidence jsonb not null, revision integer not null default 1 check(revision>0),
 approved_by uuid, approved_at timestamptz, published_at timestamptz,
 created_by uuid not null, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), unique(property_id,month)
);
create index delivery_reports_source on public.delivery_reports(source_report_id);
create index delivery_reports_scope on public.delivery_reports(org_id,property_id,published_at desc,id);
create table public.delivery_reporting_policies (
 property_id uuid primary key references public.properties(id), org_id uuid not null references public.organizations(id),
 enabled boolean not null, authorized_by uuid not null, revision integer not null default 1,
 updated_at timestamptz not null default clock_timestamp()
);
create index delivery_reporting_policies_org on public.delivery_reporting_policies(org_id);
create table public.delivery_commands (
 id uuid primary key, org_id uuid not null references public.organizations(id), property_id uuid not null references public.properties(id),
 actor_id uuid not null, operation text not null, input jsonb not null, result jsonb not null,
 created_at timestamptz not null default clock_timestamp(), training_eligible boolean not null default false check(not training_eligible)
);
create index delivery_commands_property on public.delivery_commands(property_id);
create index delivery_commands_scope on public.delivery_commands(org_id,property_id,created_at desc,id);

alter table public.delivery_outcomes enable row level security;
alter table public.delivery_work enable row level security;
alter table public.delivery_quality enable row level security;
alter table public.delivery_reports enable row level security;
alter table public.delivery_reporting_policies enable row level security;
alter table public.delivery_commands enable row level security;
revoke all on public.delivery_outcomes,public.delivery_work,public.delivery_quality,public.delivery_reports,public.delivery_reporting_policies,public.delivery_commands from public,anon,authenticated;
grant select,insert,update on public.delivery_outcomes,public.delivery_work,public.delivery_reports,public.delivery_reporting_policies to service_role;
grant select,insert on public.delivery_quality,public.delivery_commands to service_role;
create trigger delivery_commands_immutable before update or delete on public.delivery_commands for each row execute function public.protect_shared_action_history();
create trigger delivery_quality_immutable before update or delete on public.delivery_quality for each row execute function public.protect_shared_action_history();

create function private.delivery_access(p_actor uuid,p_property uuid,p_write boolean default false,p_manage boolean default false) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.profiles a join public.properties p on p.org_id=a.org_id where a.id=p_actor and p.id=p_property
 and (not p_write or a.role in('admin','manager')) and (not p_manage or a.role in('admin','manager'))
 and not coalesce((public.team_member_view(a.id)->>'accessBlocked')::boolean,true));
$$;
revoke all on function private.delivery_access(uuid,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function private.delivery_access(uuid,uuid,boolean,boolean) to service_role;

-- Counts are inquiry cohorts: one stored lead per stage, through the selected end date.
-- Native tour sources and reported outcomes are unioned before counting. Advertising
-- conversions are never used here. A lead is a stored record, not identity resolution.
create function private.delivery_funnel(p_property uuid,p_start date,p_end date) returns jsonb language sql stable security invoker set search_path='' as $$
 with cohort as (
  select l.id,l.created_at,coalesce(nullif(l.source,''),'Unknown') source from public.leads l join public.properties p on p.id=l.property_id
  where l.property_id=p_property and (l.org_id is null or l.org_id=p.org_id) and l.created_at>=p_start::timestamp at time zone 'UTC' and l.created_at<(p_end+1)::timestamp at time zone 'UTC'
 ), stages as (
  select c.id,'booked' stage from cohort c join public.tours t on t.lead_id=c.id and t.property_id=p_property where t.status<>'cancelled' and t.tour_date between (c.created_at at time zone 'UTC')::date and p_end
  union select c.id,'booked' from cohort c join public.tour_bookings t on t.lead_id=c.id and t.property_id=p_property where t.status<>'cancelled' and t.scheduled_date between (c.created_at at time zone 'UTC')::date and p_end
  union select c.id,'attended' from cohort c join public.tours t on t.lead_id=c.id and t.property_id=p_property where t.status='completed' and t.tour_date between (c.created_at at time zone 'UTC')::date and p_end
  union select c.id,'attended' from cohort c join public.tour_bookings t on t.lead_id=c.id and t.property_id=p_property where t.status='completed' and t.scheduled_date between (c.created_at at time zone 'UTC')::date and p_end
  union select c.id,o.stage from cohort c join public.delivery_outcomes o on o.lead_id=c.id and o.property_id=p_property join public.properties p on p.id=o.property_id and p.org_id=o.org_id where o.state='active' and o.occurred_on between (c.created_at at time zone 'UTC')::date and p_end
 ), per_lead as (
 select c.id,c.source,bool_or(s.stage='booked') booked,bool_or(s.stage='attended') attended,bool_or(s.stage='application') application,bool_or(s.stage='lease') lease from cohort c left join stages s on s.id=c.id group by c.id,c.source
 ) select jsonb_build_object('definition','inquiry-cohort-v1','start',p_start,'end',p_end,'inquiries',(select count(*)from cohort),
 'booked',(select count(*)from per_lead where booked),'attended',(select count(*)from per_lead where attended),'applications',(select count(*)from per_lead where application),'leases',(select count(*)from per_lead where lease),
 'sources',(select coalesce(jsonb_agg(to_jsonb(x)order by x.source),'[]')from(select source,count(*) inquiries,count(*)filter(where booked)booked,count(*)filter(where attended)attended,count(*)filter(where application)applications,count(*)filter(where lease)leases from per_lead group by source)x),
 'reportedRecords',(select count(*)from public.delivery_outcomes o join cohort c on c.id=o.lead_id join public.properties p on p.id=o.property_id and p.org_id=o.org_id where o.property_id=p_property and o.state='active' and o.occurred_on between p_start and p_end),
 'lastOutcomeUpdate',(select max(o.updated_at)from public.delivery_outcomes o join public.properties p on p.id=o.property_id and p.org_id=o.org_id where o.property_id=p_property),
 'limitations','Stored inquiry records, not deduplicated people across CRM systems. Reported applications and leases require staff evidence; no live PMS reconciliation is implied. Stages are observed separately and are not inferred. Later outcomes are excluded from this period.');
$$;
revoke all on function private.delivery_funnel(uuid,date,date) from public,anon,authenticated;
grant execute on function private.delivery_funnel(uuid,date,date) to service_role;

create function public.read_delivery_workspace(p_actor_id uuid,p_property_id uuid,p_input jsonb default '{}') returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare org uuid; offset_n int:=coalesce((p_input->>'offset')::int,0); term text:=coalesce(p_input->>'search',''); starts date:=coalesce((p_input->>'start')::date,(now()at time zone'UTC')::date-29); ends date:=coalesce((p_input->>'end')::date,(now()at time zone'UTC')::date);begin
 if not private.delivery_access(p_actor_id,p_property_id)then return '{"state":"forbidden"}';end if;
 if offset_n not between 0 and 100000 or length(term)>100 or ends<starts or ends-starts>365 then return '{"state":"invalid_input"}';end if;
 select org_id into org from public.properties where id=p_property_id;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',private.delivery_access(p_actor_id,p_property_id,true,true),'offset',offset_n,
 'funnel',private.delivery_funnel(p_property_id,starts,ends),
 'previousFunnel',private.delivery_funnel(p_property_id,starts-(ends-starts+1),starts-1),
 'members',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',coalesce(full_name,'Team member'))order by full_name,id),'[]')from public.profiles where org_id=org and role in('admin','manager') and not coalesce((public.team_member_view(id)->>'accessBlocked')::boolean,true)),
 'leads',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from(select id,concat_ws(' ',first_name,last_name)name,source,created_at from public.leads where property_id=p_property_id and (org_id is null or org_id=org) and (term=''or concat_ws(' ',first_name,last_name,external_crm_id) ilike '%'||replace(replace(replace(term,'\','\\'),'%','\%'),'_','\_')||'%') order by created_at desc,id limit 50)x),
 'work',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from(select *from public.delivery_work where property_id=p_property_id and org_id=org order by (status in('measured','cancelled')),due_on,updated_at desc,id limit 50 offset offset_n)x),
 'workTotal',(select count(*)from public.delivery_work where property_id=p_property_id and org_id=org),
 'workSummary',(select jsonb_build_object('open',count(*)filter(where status not in('measured','cancelled')),'overdue',count(*)filter(where status not in('measured','cancelled')and due_on<(now()at time zone'UTC')::date),'needsReview',count(*)filter(where status='review'),'blocked',count(*)filter(where status='blocked'))from public.delivery_work where property_id=p_property_id and org_id=org),
 'outcomes',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from(select o.*,concat_ws(' ',l.first_name,l.last_name)lead_name from public.delivery_outcomes o join public.leads l on l.id=o.lead_id and l.property_id=o.property_id where o.property_id=p_property_id and o.org_id=org order by o.updated_at desc,o.id limit 50 offset offset_n)x),
 'outcomeTotal',(select count(*)from public.delivery_outcomes where property_id=p_property_id and org_id=org),
 'reports',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from(select *from public.delivery_reports where property_id=p_property_id and org_id=org order by month desc,id limit 50 offset offset_n)x),
 'reportTotal',(select count(*)from public.delivery_reports where property_id=p_property_id and org_id=org),
 'quality',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from(select q.*,w.title from public.delivery_quality q join public.delivery_work w on w.id=q.work_id where q.property_id=p_property_id and q.org_id=org order by q.created_at desc,q.id limit 50 offset offset_n)x),
 'qualityTotal',(select count(*)from public.delivery_quality where property_id=p_property_id and org_id=org),
 'evidence',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from(select id,product,action,created_at from public.shared_action_events where property_id=p_property_id and org_id=org and evidence='server_confirmed' and phase='succeeded' and product in('siteforge','propertyaudit','bi','lumaleasing','tourspark','leadpulse','forgestudio','marketvision','brandforge','crm','property','knowledge','reviewflow') order by created_at desc,id limit 50 offset offset_n)x),
 'evidenceTotal',(select count(*)from public.shared_action_events where property_id=p_property_id and org_id=org and evidence='server_confirmed'and phase='succeeded'and product in('siteforge','propertyaudit','bi','lumaleasing','tourspark','leadpulse','forgestudio','marketvision','brandforge','crm','property','knowledge','reviewflow')),
 'policy',(select to_jsonb(s)from public.delivery_reporting_policies s where s.property_id=p_property_id and s.org_id=org),
 'history',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from(select id,operation,result,created_at from public.delivery_commands where property_id=p_property_id and org_id=org order by created_at desc,id limit 50 offset offset_n)x),
 'historyTotal',(select count(*)from public.delivery_commands where property_id=p_property_id and org_id=org));
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then return '{"state":"invalid_input"}';
end $$;
revoke all on function public.read_delivery_workspace(uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.read_delivery_workspace(uuid,uuid,jsonb)to service_role;

create function public.decide_delivery(p_id uuid,p_actor_id uuid,p_property_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare org uuid;op text:=p_input->>'operation';saved public.delivery_commands; result jsonb; before_value jsonb; after_value jsonb;
 w public.delivery_work;o public.delivery_outcomes;r public.delivery_reports; policy public.delivery_reporting_policies;
 target uuid;lead uuid;owner uuid;event uuid;event_time timestamptz;month_start date;month_end date;src jsonb;rv jsonb;ev jsonb;assessment jsonb;
 allowed text[];new_status text;count_n integer:=0;row_input jsonb;batch_result jsonb:='[]';today date:=(now()at time zone'UTC')::date;
begin
 if not private.delivery_access(p_actor_id,p_property_id,true)then return '{"state":"forbidden"}';end if;
 select org_id into org from public.properties where id=p_property_id for share;
 perform id from public.profiles where id=p_actor_id for share;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,61001));
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,61002));
 select *into saved from public.delivery_commands where id=p_id;
 if found then
  if(saved.org_id,saved.property_id,saved.actor_id)is distinct from(org,p_property_id,p_actor_id)or(op<>'cancel_request'and saved.operation<>'cancel_request'and saved.input<>p_input)then return '{"state":"request_conflict"}';end if;
  return saved.result||'{"state":"replayed"}'::jsonb;
 end if;
 allowed:=case op
 when'outcomes' then array['operation','rows'] when'outcome_withdraw' then array['operation','targetId','revision','reason']
 when'work_save'then array['operation','targetId','revision','title','product','playbook','ownerId','dueOn','nextStep','proposal','clientSummary','baselineEvent']
 when'work_transition'then array['operation','targetId','revision','status','nextStep','evidenceId']
 when'quality_review'then array['operation','targetId','revision','evidenceId','assessment']
 when'cancel_request'then array['operation'] when'report_refresh'then array['operation','targetId','revision'] when'report_draft'then array['operation','month'] when'report_edit'then array['operation','targetId','revision','summary','nextSteps']
 when'report_transition'then array['operation','targetId','revision','status'] when'report_policy'then array['operation','revision','enabled'] end;
 if allowed is null or jsonb_typeof(p_input)is distinct from'object'or p_input-allowed<>'{}'then return '{"state":"invalid_input"}';end if;
 if op='cancel_request'then result:='{"status":"cancelled"}';
 elsif op='outcomes'then
  if jsonb_typeof(p_input->'rows')is distinct from'array'or jsonb_array_length(p_input->'rows')not between 1 and 100 then return '{"state":"invalid_input"}';end if;
  -- Validate the whole reviewed batch before changing any row.
  for row_input in select value from jsonb_array_elements(p_input->'rows')loop
   if jsonb_typeof(row_input)is distinct from'object'or row_input-array['leadId','stage','occurredOn','source','reference','revision','reason']<>'{}'or coalesce(row_input->>'stage','')not in('booked','attended','application','lease')or coalesce(row_input->>'source','')not in('staff_reported','reviewed_import')or coalesce(length(btrim(row_input->>'reference')),0)not between 3 and 500 or coalesce(length(row_input->>'reason'),0)>1000 or (row_input->>'occurredOn')is null then return '{"state":"invalid_input"}';end if;
   lead:=(row_input->>'leadId')::uuid;
   if not exists(select 1 from public.leads where id=lead and property_id=p_property_id and (org_id is null or org_id=org) and (row_input->>'occurredOn')::date between (created_at at time zone'UTC')::date and today)then return '{"state":"invalid_lead"}';end if;
   select *into o from public.delivery_outcomes where property_id=p_property_id and lead_id=lead and stage=row_input->>'stage';
   if found then
    if o.org_id<>org then return '{"state":"forbidden"}';end if;
    if row_input->>'revision'is null then
     if(o.occurred_on,o.source,o.reference,o.state)is distinct from((row_input->>'occurredOn')::date,row_input->>'source',btrim(row_input->>'reference'),'active')then return '{"state":"duplicate_outcome"}';end if;
    elsif o.revision<>(row_input->>'revision')::int then return '{"state":"changed"}';
    elsif coalesce(length(btrim(row_input->>'reason')),0)<3 then return '{"state":"reason_required"}';end if;
   elsif row_input->>'revision'is not null then return '{"state":"changed"}';end if;
  end loop;
  if (select count(*)from jsonb_array_elements(p_input->'rows'))<>(select count(distinct(value->>'leadId',value->>'stage'))from jsonb_array_elements(p_input->'rows'))then return '{"state":"duplicate_outcome"}';end if;
  before_value:='[]';
  for row_input in select value from jsonb_array_elements(p_input->'rows')loop
   select *into o from public.delivery_outcomes where property_id=p_property_id and lead_id=(row_input->>'leadId')::uuid and stage=row_input->>'stage';
   if found then
    before_value:=before_value||jsonb_build_array(to_jsonb(o));
    if row_input->>'revision'is not null then
     update public.delivery_outcomes set occurred_on=(row_input->>'occurredOn')::date,source=row_input->>'source',reference=btrim(row_input->>'reference'),state='active',revision=revision+1,updated_by=p_actor_id,updated_at=clock_timestamp()where id=o.id returning *into o;
    end if;
   else
    insert into public.delivery_outcomes(org_id,property_id,lead_id,stage,occurred_on,source,reference,updated_by)values(org,p_property_id,(row_input->>'leadId')::uuid,row_input->>'stage',(row_input->>'occurredOn')::date,row_input->>'source',btrim(row_input->>'reference'),p_actor_id)returning *into o;
   end if;
   batch_result:=batch_result||jsonb_build_array(jsonb_build_object('id',o.id,'revision',o.revision));count_n:=count_n+1;
  end loop;
  after_value:=batch_result;result:=jsonb_build_object('count',count_n,'records',batch_result);
 elsif op='outcome_withdraw'then
  select *into o from public.delivery_outcomes where id=(p_input->>'targetId')::uuid and property_id=p_property_id and org_id=org for update;
  if not found then return '{"state":"not_found"}';end if;
  if o.revision is distinct from(p_input->>'revision')::int then return '{"state":"changed"}';end if;
  if o.state<>'active'or coalesce(length(btrim(p_input->>'reason')),0)not between 3 and 1000 then return '{"state":"invalid_input"}';end if;
  before_value:=to_jsonb(o);update public.delivery_outcomes set state='withdrawn',revision=revision+1,updated_by=p_actor_id,updated_at=clock_timestamp()where id=o.id returning *into o;
  after_value:=to_jsonb(o);result:=jsonb_build_object('targetId',o.id,'revision',o.revision);
 elsif op='work_save'then
  target:=coalesce((p_input->>'targetId')::uuid,p_id);owner:=(p_input->>'ownerId')::uuid;
  if coalesce(length(btrim(p_input->>'title')),0)not between 3 and 160 or coalesce(length(btrim(p_input->>'nextStep')),0)not between 3 and 1000 or coalesce(length(p_input->>'proposal'),0)>4000 or coalesce(length(p_input->>'clientSummary'),0)>2000 or coalesce(p_input->>'product','')not in('siteforge','propertyaudit','bi','tourspark','lumaleasing','leadpulse','crm','forgestudio','reviewflow','marketvision','brandforge','property','knowledge')or coalesce(p_input->>'playbook','')not in('custom','website_improvement','onboarding','monthly_review','rebrand')or p_input->>'dueOn'is null or (p_input->>'dueOn')::date not between today-366 and today+730 or not private.delivery_access(owner,p_property_id,true)then return '{"state":"invalid_input"}';end if;
  event:=(p_input->>'baselineEvent')::uuid;
  if event is not null and not exists(select 1 from public.shared_action_events where id=event and org_id=org and property_id=p_property_id and evidence='server_confirmed'and phase='succeeded'and (p_input->>'playbook'<>'website_improvement'or product='propertyaudit'))then return '{"state":"invalid_evidence"}';end if;
  if p_input->>'playbook'='website_improvement'and p_input->>'product'<>'siteforge'then return '{"state":"invalid_input"}';end if;
  if p_input->>'playbook'='website_improvement'and event is null then return '{"state":"baseline_required"}';end if;
  select *into w from public.delivery_work where id=target for update;
  if found then
   if(w.org_id,w.property_id)is distinct from(org,p_property_id)then return '{"state":"not_found"}';end if;
   if w.revision is distinct from(p_input->>'revision')::int then return '{"state":"changed"}';end if;
   if w.status not in('draft','review','blocked','approved')then return '{"state":"closed_work"}';end if;
   before_value:=to_jsonb(w);
   update public.delivery_work set title=btrim(p_input->>'title'),product=p_input->>'product',playbook=p_input->>'playbook',owner_id=owner,due_on=(p_input->>'dueOn')::date,next_step=btrim(p_input->>'nextStep'),proposal=coalesce(p_input->>'proposal',''),client_summary=coalesce(p_input->>'clientSummary',''),baseline_event=event,status='draft',approved_by=null,approved_at=null,revision=revision+1,updated_at=clock_timestamp()where id=target returning *into w;
  else
   if p_input->>'revision'is not null or p_input->>'targetId'is not null then return '{"state":"not_found"}';end if;
   insert into public.delivery_work(id,org_id,property_id,title,product,playbook,owner_id,due_on,next_step,proposal,client_summary,baseline_event,created_by)values(target,org,p_property_id,btrim(p_input->>'title'),p_input->>'product',p_input->>'playbook',owner,(p_input->>'dueOn')::date,btrim(p_input->>'nextStep'),coalesce(p_input->>'proposal',''),coalesce(p_input->>'clientSummary',''),event,p_actor_id)returning *into w;
  end if;
  after_value:=to_jsonb(w);result:=jsonb_build_object('targetId',w.id,'revision',w.revision);
 elsif op='work_transition'then
  select *into w from public.delivery_work where id=(p_input->>'targetId')::uuid and property_id=p_property_id and org_id=org for update;
  if not found then return '{"state":"not_found"}';end if;
  if w.revision is distinct from(p_input->>'revision')::int then return '{"state":"changed"}';end if;
  new_status:=p_input->>'status';event:=(p_input->>'evidenceId')::uuid;
  if coalesce(length(btrim(p_input->>'nextStep')),0)not between 3 and 1000 then return '{"state":"invalid_input"}';end if;
  if not((w.status='draft'and new_status='review')or(w.status='review'and new_status='approved')or(w.status='approved'and new_status='released')or(w.status='released'and new_status='measured')or(w.status='blocked'and new_status='draft')or(w.status in('draft','review','approved','released')and new_status='blocked')or(w.status not in('measured','cancelled')and new_status='cancelled'))then return '{"state":"invalid_transition"}';end if;
  if new_status in('review','approved')and length(btrim(w.proposal))<10 then return '{"state":"proposal_required"}';end if;
  if new_status='released'and not private.delivery_access(w.approved_by,p_property_id,true,true)then return '{"state":"approval_expired"}';end if;
  if new_status in('released','measured')then
   select created_at into event_time from public.shared_action_events where id=event and org_id=org and property_id=p_property_id and evidence='server_confirmed'and phase='succeeded'
   and (case when w.playbook='website_improvement'and new_status='released'then product='siteforge'and action='site.delivery.reviewed' when w.playbook='website_improvement'and new_status='measured'then product='propertyaudit'and action in('audit.evaluation.applied','audit.run_reviewed','audit.report.prepared')else product=w.product end);
   if not found or (new_status='released'and event_time<w.approved_at)or(new_status='measured'and(event_time<=w.released_at or event=w.release_event or event=w.baseline_event))then return '{"state":"invalid_evidence"}';end if;
  end if;
  before_value:=to_jsonb(w);
  update public.delivery_work set status=new_status,next_step=btrim(p_input->>'nextStep'),
   approved_by=case when new_status='approved'then p_actor_id when new_status in('draft','blocked')then null else approved_by end,
   approved_at=case when new_status='approved'then clock_timestamp()when new_status in('draft','blocked')then null else approved_at end,
   release_event=case when new_status='released'then event else release_event end,released_at=case when new_status='released'then event_time else released_at end,
   measurement_event=case when new_status='measured'then event else measurement_event end,measured_at=case when new_status='measured'then event_time else measured_at end,
   revision=revision+1,updated_at=clock_timestamp()where id=w.id returning *into w;
  after_value:=to_jsonb(w);result:=jsonb_build_object('targetId',w.id,'revision',w.revision,'status',w.status);
 elsif op='quality_review'then
  select *into w from public.delivery_work where id=(p_input->>'targetId')::uuid and property_id=p_property_id and org_id=org for share;
  if not found then return '{"state":"not_found"}';end if;
  if w.revision is distinct from(p_input->>'revision')::int then return '{"state":"changed"}';end if;
  event:=(p_input->>'evidenceId')::uuid;assessment:=p_input->'assessment';
  if not exists(select 1 from public.shared_action_events where id=event and org_id=org and property_id=p_property_id and product=w.product and evidence='server_confirmed'and phase='succeeded'and created_at>=w.created_at)then return '{"state":"invalid_evidence"}';end if;
  if jsonb_typeof(assessment)is distinct from'object'or not(assessment ?& array['model','factual','brand','complete','score','corrections','baselineMinutes','deliveryMinutes','reviewMinutes','correctionMinutes','costUsd'])or assessment-array['model','factual','brand','complete','score','corrections','baselineMinutes','deliveryMinutes','reviewMinutes','correctionMinutes','costUsd']<>'{}'or coalesce(length(btrim(assessment->>'model')),0)not between 1 and 120 or coalesce(length(btrim(assessment->>'corrections')),0)not between 3 and 2000 or jsonb_typeof(assessment->'factual')is distinct from'boolean'or jsonb_typeof(assessment->'brand')is distinct from'boolean'or jsonb_typeof(assessment->'complete')is distinct from'boolean'or coalesce((assessment->>'score')::int,0)not between 1 and 5 then return '{"state":"invalid_input"}';end if;
  for row_input in select value from jsonb_each(assessment)where key in('baselineMinutes','deliveryMinutes','reviewMinutes','correctionMinutes','costUsd')loop
   if row_input<>'null'::jsonb and(jsonb_typeof(row_input)<>'number'or row_input::numeric not between 0 and 100000)then return '{"state":"invalid_input"}';end if;
  end loop;
  insert into public.delivery_quality(id,org_id,property_id,work_id,work_revision,evidence_id,actor_id,assessment)values(p_id,org,p_property_id,w.id,w.revision,event,p_actor_id,assessment);
  after_value:=assessment;result:=jsonb_build_object('targetId',w.id,'reviewId',p_id);
 elsif op='report_draft'then
  if coalesce(p_input->>'month','')!~'^\d{4}-\d{2}$'then return '{"state":"invalid_input"}';end if;
  month_start:=((p_input->>'month')||'-01')::date;month_end:=(month_start+interval'1 month -1 day')::date;
  if month_end>=today or month_start<date_trunc('month',today)-interval'24 months'then return '{"state":"incomplete_month"}';end if;
  select *into r from public.delivery_reports where property_id=p_property_id and month=month_start;
  if found then
   if r.org_id<>org then return '{"state":"forbidden"}';end if;
   result:=jsonb_build_object('targetId',r.id,'revision',r.revision,'status',r.state,'existing',true);
  else
   src:=public.bi_report_source(p_actor_id,p_property_id,jsonb_build_object('startDate',month_start,'endDate',month_end,'compare',true,'channel',null,'account',null));
   if src->>'state'<>'ready'then return src;end if;
   target:=gen_random_uuid();
   rv:=public.save_bi_report(target,p_actor_id,p_property_id,jsonb_build_object('label',to_char(month_start,'FMMonth YYYY')||' · Client report','filters',src->'source'->'filters','sourceHash',src->>'sourceHash'));
   if rv->>'state'not in('saved','replayed')then return rv;end if;
   ev:=jsonb_build_object('funnel',private.delivery_funnel(p_property_id,month_start,month_end),'previousFunnel',private.delivery_funnel(p_property_id,(src->'source'->'previousPeriod'->>'start')::date,(src->'source'->'previousPeriod'->>'end')::date),
    'goals',(select coalesce(jsonb_agg(jsonb_build_object('metric',metric_key,'target',target_value,'type',goal_type,'inverse',is_inverse)order by metric_key,id),'[]')from public.metric_goals where property_id=p_property_id and is_active),
    'completedWork',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'summary',client_summary,'completedAt',measured_at)order by measured_at,id),'[]')from public.delivery_work where property_id=p_property_id and org_id=org and status='measured'and client_summary<>''and measured_at>=month_start::timestamp at time zone'UTC'and measured_at<(month_end+1)::timestamp at time zone'UTC'),
    'capturedAt',clock_timestamp());
   insert into public.delivery_reports(id,source_report_id,org_id,property_id,month,evidence,created_by)values(target,target,org,p_property_id,month_start,ev,p_actor_id)returning *into r;
   result:=jsonb_build_object('targetId',r.id,'revision',r.revision,'status',r.state);after_value:=to_jsonb(r);
  end if;
 elsif op='report_refresh'then
  select *into r from public.delivery_reports where id=(p_input->>'targetId')::uuid and property_id=p_property_id and org_id=org for update;
  if not found then return '{"state":"not_found"}';end if;
  if r.revision is distinct from(p_input->>'revision')::int then return '{"state":"changed"}';end if;
  if r.state not in('draft','withdrawn')then return '{"state":"published_report"}';end if;
  before_value:=to_jsonb(r);month_start:=r.month;month_end:=(month_start+interval'1 month -1 day')::date;
   src:=public.bi_report_source(p_actor_id,p_property_id,jsonb_build_object('startDate',month_start,'endDate',month_end,'compare',true,'channel',null,'account',null));
   if src->>'state'<>'ready'then return src;end if;
   target:=gen_random_uuid();
   rv:=public.save_bi_report(target,p_actor_id,p_property_id,jsonb_build_object('label',to_char(month_start,'FMMonth YYYY')||' · Client report','filters',src->'source'->'filters','sourceHash',src->>'sourceHash'));
   if rv->>'state'not in('saved','replayed')then return rv;end if;
   ev:=jsonb_build_object('funnel',private.delivery_funnel(p_property_id,month_start,month_end),'previousFunnel',private.delivery_funnel(p_property_id,(src->'source'->'previousPeriod'->>'start')::date,(src->'source'->'previousPeriod'->>'end')::date),
    'goals',(select coalesce(jsonb_agg(jsonb_build_object('metric',metric_key,'target',target_value,'type',goal_type,'inverse',is_inverse)order by metric_key,id),'[]')from public.metric_goals where property_id=p_property_id and is_active),
    'completedWork',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'summary',client_summary,'completedAt',measured_at)order by measured_at,id),'[]')from public.delivery_work where property_id=p_property_id and org_id=org and status='measured'and client_summary<>''and measured_at>=month_start::timestamp at time zone'UTC'and measured_at<(month_end+1)::timestamp at time zone'UTC'),
    'capturedAt',clock_timestamp());
  update public.delivery_reports set source_report_id=target,evidence=ev,state='draft',approved_by=null,approved_at=null,published_at=null,revision=revision+1,updated_at=clock_timestamp()where id=r.id returning *into r;
  after_value:=to_jsonb(r);result:=jsonb_build_object('targetId',r.id,'revision',r.revision,'status',r.state);
 elsif op in('report_edit','report_transition')then
  select *into r from public.delivery_reports where id=(p_input->>'targetId')::uuid and property_id=p_property_id and org_id=org for update;
  if not found then return '{"state":"not_found"}';end if;
  if r.revision is distinct from(p_input->>'revision')::int then return '{"state":"changed"}';end if;
  before_value:=to_jsonb(r);
  if op='report_edit'then
   if r.state='published'then return '{"state":"published_report"}';end if;
   if coalesce(length(btrim(p_input->>'summary')),0)not between 10 and 4000 or coalesce(length(btrim(p_input->>'nextSteps')),0)not between 3 and 2000 then return '{"state":"invalid_input"}';end if;
   update public.delivery_reports set summary=btrim(p_input->>'summary'),next_steps=btrim(p_input->>'nextSteps'),state='draft',approved_by=null,approved_at=null,published_at=null,revision=revision+1,updated_at=clock_timestamp()where id=r.id returning *into r;
  else
   new_status:=p_input->>'status';
   if not((r.state='draft'and new_status='approved')or(r.state='approved'and new_status='published')or(r.state in('approved','published')and new_status='withdrawn'))then return '{"state":"invalid_transition"}';end if;
   if length(r.summary)<10 or length(r.next_steps)<3 then return '{"state":"summary_required"}';end if;
   if new_status='published'and not private.delivery_access(r.approved_by,p_property_id,true,true)then return '{"state":"approval_expired"}';end if;
   update public.delivery_reports set state=new_status,approved_by=case when new_status='approved'then p_actor_id else approved_by end,approved_at=case when new_status='approved'then clock_timestamp()else approved_at end,published_at=case when new_status='published'then clock_timestamp()else published_at end,revision=revision+1,updated_at=clock_timestamp()where id=r.id returning *into r;
  end if;
  after_value:=to_jsonb(r);result:=jsonb_build_object('targetId',r.id,'revision',r.revision,'status',r.state);
 elsif op='report_policy'then
  if jsonb_typeof(p_input->'enabled')is distinct from'boolean'then return '{"state":"invalid_input"}';end if;
  select *into policy from public.delivery_reporting_policies where property_id=p_property_id for update;
  if found and(policy.org_id<>org or policy.revision is distinct from(p_input->>'revision')::int)then return '{"state":"changed"}';end if;
  if not found and p_input->>'revision'is not null then return '{"state":"changed"}';end if;
  before_value:=to_jsonb(policy);
  insert into public.delivery_reporting_policies(property_id,org_id,enabled,authorized_by)values(p_property_id,org,(p_input->>'enabled')::boolean,p_actor_id)
  on conflict(property_id)do update set enabled=excluded.enabled,authorized_by=excluded.authorized_by,revision=public.delivery_reporting_policies.revision+1,updated_at=clock_timestamp()returning *into policy;
  after_value:=to_jsonb(policy);result:=jsonb_build_object('revision',policy.revision,'enabled',policy.enabled);
 end if;
 result:=coalesce(result,'{}')||jsonb_build_object('state','saved','id',p_id,'propertyId',p_property_id,'triggerSource',case when current_setting('p11.delivery_trigger',true)='monthly_policy'then'monthly_schedule'else'console'end);
 insert into public.delivery_commands(id,org_id,property_id,actor_id,operation,input,result)values(p_id,org,p_property_id,p_actor_id,op,p_input,result);
 -- These are confirmed recording decisions, never claims of external execution.
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,service_principal,origin)values(p_id,org,p_property_id,case when current_setting('p11.delivery_trigger',true)='monthly_policy'then null else p_actor_id end,case when current_setting('p11.delivery_trigger',true)='monthly_policy'then'client-report-drafts'end,case when current_setting('p11.delivery_trigger',true)='monthly_policy'then'workflow'else'console'end);
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,service_principal,product,action,evidence,phase,request,before_state,after_state,result)
 values(p_id,p_id,org,p_property_id,case when current_setting('p11.delivery_trigger',true)='monthly_policy'then null else p_actor_id end,case when current_setting('p11.delivery_trigger',true)='monthly_policy'then'client-report-drafts'end,'platform',case op when'outcomes'then'delivery.outcomes' when'outcome_withdraw'then'delivery.outcome_withdraw' when'work_save'then'delivery.work_save' when'work_transition'then'delivery.work_transition' when'quality_review'then'delivery.quality_review' when'report_draft'then'delivery.report_draft' when'report_edit'then'delivery.report_edit' when'report_refresh'then'delivery.report_refresh' when'report_transition'then'delivery.report_transition' when'report_policy'then'delivery.report_policy' when'cancel_request'then'delivery.cancel_request' end,'server_confirmed','succeeded',jsonb_build_object('commandId',p_id),before_value,after_value,result);
 return result;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then return '{"state":"invalid_input"}';
end $$;
revoke all on function public.decide_delivery(uuid,uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.decide_delivery(uuid,uuid,uuid,jsonb)to service_role;

create function public.read_delivery_receipt(p_actor_id uuid,p_property_id uuid,p_id uuid)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare r public.delivery_commands;begin
 if not private.delivery_access(p_actor_id,p_property_id)then return '{"state":"forbidden"}';end if;
 select *into r from public.delivery_commands where id=p_id and property_id=p_property_id and org_id=(select org_id from public.properties where id=p_property_id)and actor_id=p_actor_id;
 if not found then return jsonb_build_object('state','not_recorded','id',p_id,'propertyId',p_property_id);end if;
 return r.result||'{"state":"replayed"}';
end $$;
revoke all on function public.read_delivery_receipt(uuid,uuid,uuid)from public,anon,authenticated;
grant execute on function public.read_delivery_receipt(uuid,uuid,uuid)to service_role;

-- Opt-in monthly drafting only. Author's current access is rechecked; no email,
-- client publication, provider write or model call is part of the worker.
create function public.draft_due_client_reports(p_limit integer default 10)returns jsonb language plpgsql security invoker set search_path=''as $$
declare p public.delivery_reporting_policies;r jsonb;results jsonb:='[]';month_key text:=to_char((now()at time zone'UTC')-interval'1 month','YYYY-MM');begin
 if p_limit not between 1 and 50 then return '{"state":"invalid_input"}';end if;
 for p in select s.*from public.delivery_reporting_policies s join public.properties pr on pr.id=s.property_id and pr.org_id=s.org_id where enabled and private.delivery_access(s.authorized_by,s.property_id,true,true) and not exists(select 1 from public.delivery_reports r where r.property_id=s.property_id and r.month=(month_key||'-01')::date)order by s.updated_at,s.property_id limit p_limit for update of s skip locked loop
  perform set_config('p11.delivery_trigger','monthly_policy',true);
  r:=public.decide_delivery(gen_random_uuid(),p.authorized_by,p.property_id,jsonb_build_object('operation','report_draft','month',month_key));
  perform set_config('p11.delivery_trigger','',true);
  results:=results||jsonb_build_array(jsonb_build_object('propertyId',p.property_id,'result',r));
 end loop;
 return jsonb_build_object('state','ready','results',results);
end $$;
revoke all on function public.draft_due_client_reports(integer)from public,anon,authenticated;
grant execute on function public.draft_due_client_reports(integer)to service_role;

create function public.read_client_delivery(p_actor_id uuid,p_property_id uuid,p_start date,p_end date,p_offset integer default 0)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare scope jsonb;org uuid;begin
 scope:=public.read_client_portal_scope(p_actor_id);
 if scope->>'state'<>'ready'or not exists(select 1 from jsonb_array_elements(scope->'properties')p where p->>'id'=p_property_id::text)then return '{"state":"forbidden"}';end if;
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>365 or p_offset not between 0 and 100000 then return '{"state":"invalid_input"}';end if;
 org:=(scope->>'orgId')::uuid;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'funnel',private.delivery_funnel(p_property_id,p_start,p_end),'previousFunnel',private.delivery_funnel(p_property_id,p_start-(p_end-p_start+1),p_start-1),
 'goals',(select coalesce(jsonb_agg(jsonb_build_object('metric',metric_key,'target',target_value,'type',goal_type,'inverse',is_inverse)order by metric_key,id),'[]')from public.metric_goals where property_id=p_property_id and is_active),
 'reports','[]'::jsonb);
end $$;
revoke all on function public.read_client_delivery(uuid,uuid,date,date,integer)from public,anon,authenticated;
grant execute on function public.read_client_delivery(uuid,uuid,date,date,integer)to service_role;

create function public.read_delivery_report(p_actor_id uuid,p_property_id uuid,p_report_id uuid)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare r public.delivery_reports;src jsonb;begin
 if not private.delivery_access(p_actor_id,p_property_id)then return '{"state":"forbidden"}';end if;
 select *into r from public.delivery_reports where id=p_report_id and property_id=p_property_id and org_id=(select org_id from public.properties where id=p_property_id);
 if not found then return '{"state":"not_found"}';end if;
 select source into src from public.bi_reports where id=r.source_report_id and property_id=p_property_id and org_id=r.org_id and state='saved';
 if not found then return '{"state":"not_found"}';end if;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'report',to_jsonb(r),'source',src);
end $$;
revoke all on function public.read_delivery_report(uuid,uuid,uuid)from public,anon,authenticated;
grant execute on function public.read_delivery_report(uuid,uuid,uuid)to service_role;

create function public.read_published_delivery_reports(p_actor_id uuid,p_property_id uuid default null,p_offset integer default 0)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare scope jsonb;org uuid;ids uuid[];begin
 scope:=public.read_client_portal_scope(p_actor_id);if scope->>'state'<>'ready'then return '{"state":"forbidden"}';end if;
 org:=(scope->>'orgId')::uuid;select array_agg((x->>'id')::uuid)into ids from jsonb_array_elements(scope->'properties')x;
 if p_property_id is not null and not coalesce(p_property_id=any(ids),false)then return '{"state":"forbidden"}';end if;
 if p_offset not between 0 and 100000 then return '{"state":"invalid_input"}';end if;
 return jsonb_build_object('state','ready','reports',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from(
 select r.id,r.summary,r.next_steps,r.evidence,r.published_at,p.name as property_name,b.label,b.source from public.delivery_reports r
 join public.properties p on p.id=r.property_id and p.org_id=r.org_id
 join public.bi_reports b on b.id=r.source_report_id and b.property_id=r.property_id and b.org_id=r.org_id and b.state='saved'
 where r.org_id=org and r.property_id=any(ids)and(p_property_id is null or r.property_id=p_property_id)and r.state='published'
 order by r.published_at desc,r.id limit 21 offset p_offset)x));
end $$;
revoke all on function public.read_published_delivery_reports(uuid,uuid,integer)from public,anon,authenticated;
grant execute on function public.read_published_delivery_reports(uuid,uuid,integer)to service_role;

notify pgrst,'reload schema';
