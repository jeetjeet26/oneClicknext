// Local integration qualification; never creates accounts or records in hosted Supabase.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
const origin = process.env.P11_QUALIFY_ORIGIN || "http://127.0.0.1:9430";
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
for (const value of [origin, supabase])
  assert.ok(
    value && ["localhost", "127.0.0.1"].includes(new URL(value).hostname),
    "Local environments only",
  );
const db = createClient(supabase, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const actor = "11111111-1111-1111-1111-111111111111",
  org = "22222222-2222-2222-2222-222222222222",
  propertyId = randomUUID(),
  foreignOrg = randomUUID(),
  foreignProperty = randomUUID(),
  unassignedProperty = randomUUID(),
  suffix = randomUUID();
const clientEmail = `intelligence-${suffix}@p11.test`,
  password = "P11-local-preview-fixture-2026!";
function sql(input) {
  return execFileSync(
    "/Applications/Docker.app/Contents/Resources/bin/docker",
    [
      "exec",
      "-i",
      "supabase_db_p11-platform",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input, stdio: ["pipe", "pipe", "pipe"] },
  ).toString();
}
async function login(email, pass) {
  const jar = new Map();
  const auth = createServerClient(
    supabase,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (values) =>
          values.forEach(({ name, value }) => jar.set(name, value)),
      },
    },
  );
  const { error } = await auth.auth.signInWithPassword({
    email,
    password: pass,
  });
  assert.ifError(error);
  return [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
}
const checks = [];
async function request(
  path,
  cookie,
  body,
  expected = 200,
  requestOrigin = origin,
) {
  const r = await fetch(origin + path, {
    method: body ? "POST" : "GET",
    redirect: "manual",
    headers: {
      cookie,
      ...(body
        ? { "Content-Type": "application/json", origin: requestOrigin }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await r.text();
  assert.equal(
    r.status,
    expected,
    `${path}: ${r.status}: ${raw.slice(0, 300)}`,
  );
  checks.push(`${body ? "POST" : "GET"} ${path.split("?")[0]} → ${r.status}`);
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
const staff = await login("local-admin@p11.test", "local-dev-password");
const created = await db.auth.admin.createUser({
  email: clientEmail,
  password,
  email_confirm: true,
});
assert.ifError(created.error);
const clientId = created.data.user.id;
sql(
  `BEGIN;INSERT INTO public.properties(id,org_id,name)VALUES('${propertyId}','${org}','Intelligence qualification — not a client'),('${unassignedProperty}','${org}','Unassigned local qualification property');INSERT INTO public.organizations(id,name)VALUES('${foreignOrg}','Intelligence isolation fixture');INSERT INTO public.properties(id,org_id,name)VALUES('${foreignProperty}','${foreignOrg}','Private isolation fixture');COMMIT;`,
);
const invite = await request("/api/client-portal/access", staff, {
  operation: "invite",
  requestId: randomUUID(),
  name: "Intelligence preview client",
  email: clientEmail,
  propertyIds: [propertyId],
});
const join = await db.rpc("join_client_portal", {
  p_id: randomUUID(),
  p_actor_id: clientId,
  p_token_hash: createHash("sha256")
    .update(invite.invitationToken)
    .digest("hex"),
  p_accept: true,
});
assert.ifError(join.error);
assert.equal(join.data.state, "joined");
const client = await login(clientEmail, password),
  today = new Date().toISOString().slice(0, 10);
let fact = {
  field: "market",
  value: "Qualification market",
  source: "Synthetic local review",
  sourceUrl: "",
  observedAt: today,
  effectiveFrom: null,
  effectiveTo: null,
  reviewAfter: "2027-01-01",
  confidence: null,
  origin: "staff",
  visibility: "public",
};
const decision = (kind, key, expectedRevision, operation, payload) => ({
  requestId: randomUUID(),
  propertyId,
  kind,
  key,
  expectedRevision,
  operation,
  ...(payload === undefined ? {} : { payload }),
  reason: "Local qualification only",
});
const first = decision("fact", "market", 0, "save", fact);
const saved = await request("/api/intelligence", staff, first);
assert.equal(saved.document.revision, 1);
assert.equal(
  (await request("/api/intelligence", staff, first)).state,
  "replayed",
);
await request(
  "/api/intelligence",
  staff,
  { ...first, requestId: randomUUID() },
  409,
);
await request(
  "/api/intelligence",
  staff,
  decision("fact", "market", 1, "approve"),
);
await request(
  "/api/intelligence",
  staff,
  decision("fact", "market", 2, "lock"),
);
await request(
  "/api/intelligence",
  staff,
  decision("fact", "market", 3, "save", { ...fact, value: "Wrong" }),
  409,
);
await request(
  "/api/intelligence",
  staff,
  { ...first, requestId: randomUUID(), propertyId: foreignProperty },
  403,
);
await request(
  "/api/intelligence",
  staff,
  first,
  403,
  "https://unrelated.example",
);
await request(
  "/api/intelligence",
  client,
  decision("fact", "market", 3, "unlock"),
  403,
);
await request(
  "/api/intelligence?propertyId=" + propertyId,
  client,
  undefined,
  403,
);
await request("/api/client/intelligence", client, { action: "save" }, 403);
const creative = {
  title: "Qualification creative direction",
  thesis: "Light, restrained editorial design",
  typography: "Clear hierarchy",
  palette: "Neutral stone",
  imagery: "Approved assets only",
  spacing: "Generous",
  motion: "Reduced-motion support",
  hero: "Property introduction",
  pageRhythm: "Alternating stories",
  voice: "Clear and helpful",
  exceptions: "",
  references: [],
  componentKeys: ["p11.hero", "p11.floorplans"],
};
await request(
  "/api/intelligence",
  staff,
  decision("creative", "property-direction", 0, "save", creative),
);
await request(
  "/api/intelligence",
  staff,
  decision("creative", "property-direction", 1, "approve"),
);
const csv = `key,date,metric,value,channel,device\nsessions-mobile,${today},sessions,120,all,mobile\ntours-mobile,${today},tour_completions,8,all,mobile\n`;
const { preview } = await request("/api/intelligence/import", staff, {
  propertyId,
  source: "Local website export",
  account: "qualification-web",
  content: csv,
});
await request(
  "/api/intelligence",
  staff,
  decision("batch", "qualification", 0, "save", preview),
);
const query = `?start=${today}&end=${today}&propertyId=${propertyId}`;
assert.equal(
  (await request("/api/client/intelligence" + query, client)).properties[0]
    .diagnostics.length,
  0,
);
await request(
  "/api/intelligence",
  staff,
  decision("batch", "qualification", 1, "approve"),
);
const release = randomUUID();
sql(
  `INSERT INTO public.shared_action_episodes(id,org_id,property_id,actor_id,origin)VALUES('${release}','${org}','${propertyId}','${actor}','console');INSERT INTO public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,result)VALUES('${release}','${release}','${org}','${propertyId}','${actor}','siteforge','site.delivery.recorded','server_confirmed','succeeded','{}','{"qualificationOnly":true,"externalExecution":false}');`,
);
const recommendation = {
  title: "Review mobile tour path",
  rationale:
    "Saved observations show 8 completions from 120 mobile sessions; this is descriptive.",
  targetMetric: "Tour completions",
  owner: "Internal review team",
  executionType: "website",
  confidence: "low",
  evidence: [
    {
      label: "Local source",
      reference: "PRIVATE-REFERENCE",
      observedAt: new Date().toISOString(),
    },
  ],
  basecampUrl: "https://basecamp.example/private-task",
  expectedImpact: "Unknown until measured",
  rollback: "Restore prior version",
  result: "",
  releaseEvent: release,
  measurementEvent: null,
};
await request(
  "/api/intelligence",
  staff,
  decision("recommendation", "qualification", 0, "save", recommendation),
);
await request(
  "/api/intelligence",
  staff,
  decision("recommendation", "qualification", 1, "approve"),
);
await request(
  "/api/intelligence",
  staff,
  decision("recommendation", "qualification", 2, "measure", {
    ...recommendation,
    result: "Too soon",
    measurementEvent: release,
  }),
  409,
);
await request(
  "/api/intelligence",
  staff,
  decision("recommendation", "qualification", 2, "implement"),
);
const measurement = randomUUID();
sql(
  `INSERT INTO public.shared_action_episodes(id,org_id,property_id,actor_id,origin)VALUES('${measurement}','${org}','${propertyId}','${actor}','console');INSERT INTO public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,result)VALUES('${measurement}','${measurement}','${org}','${propertyId}','${actor}','bi','bi.query.executed','server_confirmed','succeeded','{}','{"qualificationOnly":true,"externalExecution":false}');`,
);
await request(
  "/api/intelligence",
  staff,
  decision("recommendation", "qualification", 3, "measure", {
    ...recommendation,
    result: "Observed 8 recorded completions; no causal conclusion.",
    measurementEvent: measurement,
  }),
);
const result = await request("/api/client/intelligence" + query, client);
assert.deepEqual(
  result.properties.map((p) => p.score.id),
  [propertyId],
);
assert.equal(result.properties[0].diagnostics.length, 2);
assert.equal(result.properties[0].recommendations[0].status, "measured");
assert.ok(!JSON.stringify(result).includes("PRIVATE-REFERENCE"));
assert.ok(!JSON.stringify(result).includes("basecamp.example"));
await request(
  "/api/client/intelligence" + query.replace(propertyId, foreignProperty),
  client,
  undefined,
  403,
);
const answer = await request(
  "/api/client/intelligence" +
    query +
    "&question=Which%20property%20has%20the%20most%20tours",
  client,
);
assert.equal(answer.supported, true);
assert.deepEqual(
  answer.evidence.map((e) => e.propertyId),
  [propertyId],
);
const webflow = await request(
  "/api/intelligence?kind=webflow&propertyId=" + propertyId,
  staff,
);
assert.ok(webflow.includes("Qualification market"));
const snapshot = await request(
  "/api/siteforge/packages?propertyId=" + propertyId,
  staff,
);
assert.ok(snapshot.source.hash);
await request(
  "/api/client/intelligence" + query.replace(propertyId, unassignedProperty),
  client,
  undefined,
  403,
);
await request("/api/intelligence?propertyId=" + propertyId, "", undefined, 401);
await request("/api/client/intelligence" + query, "", undefined, 401);
const outcome = {
  passed: true,
  date: new Date().toISOString(),
  propertyId,
  clientId,
  clientEmail,
  foreignProperty,
  checks,
  notes: [
    "Local fixtures only; no outbound delivery or provider activation.",
    "No live model request made by this qualification.",
  ],
};
await writeFile(
  "/private/tmp/p11-intelligence-qualification.json",
  JSON.stringify(outcome, null, 2),
);
console.log(JSON.stringify(outcome, null, 2));
