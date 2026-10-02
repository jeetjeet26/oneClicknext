import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import axe from "axe-core";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const base = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:9430";
const password = "Local-chat-history-fixture-2026!";
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
function sql(input: string) {
  return execFileSync(
    "docker",
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
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  expect(error).toBeNull();
  return data;
}
async function login(page: Page, email: string) {
  await page.goto("/auth/login?redirect=%2Fclient%2Fconversations");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/client\/conversations/, { timeout: 60000 });
}
async function accessible(page: Page) {
  await page.evaluate(axe.source);
  const violations = await page.evaluate(
    async () =>
      (
        await (window as unknown as { axe: typeof axe }).axe.run(
          { exclude: ["nextjs-portal"] },
          {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          },
        )
      ).violations,
  );
  expect(
    violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
test("clients read only their assigned LumaLeasing chats, including paused and long histories", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240000);
  page.setDefaultTimeout(20000);
  if (
    !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
    !["localhost", "127.0.0.1"].includes(new URL(base).hostname)
  )
    throw Error("Local fixtures only");
  const suffix = randomUUID(),
    org = randomUUID(),
    otherOrg = randomUUID();
  const properties = Array.from({ length: 5 }, () => randomUUID());
  const chats = Array.from({ length: 6 }, () => randomUUID());
  const lead = randomUUID(),
    foreignLead = randomUUID();
  const staffEmail = `chat-staff-${suffix}@p11.test`,
    clientEmail = `chat-client-${suffix}@p11.test`,
    noChatEmail = `no-chat-${suffix}@p11.test`;
  const users = [];
  for (const email of [staffEmail, clientEmail, noChatEmail]) {
    const user = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(user.error).toBeNull();
    users.push(user.data.user!.id);
  }
  const [staff, client, noChat] = users;
  await writeFile(
    info.outputPath("fixture.json"),
    JSON.stringify(
      {
        staff,
        client,
        noChat,
        staffEmail,
        clientEmail,
        noChatEmail,
        properties,
        chats,
        org,
      },
      null,
      2,
    ),
  );
  sql(`begin;
    insert into public.organizations(id,name)values('${org}','Client conversation preview'),('${otherOrg}','Unrelated conversation fixture');
    select set_config('p11.team_scope','${org}',true);
    update public.profiles set org_id='${org}',role='admin',full_name='P11 conversation preview'where id='${staff}';
    insert into public.properties(id,org_id,name,address)values
      ('${properties[0]}','${org}','Harbor House — chat preview','{"city":"Portland","state":"OR"}'),
      ('${properties[1]}','${org}','Juniper Place — paused chatbot','{}'),
      ('${properties[2]}','${org}','Maple Court — no chatbot','{}'),
      ('${properties[3]}','${org}','PRIVATE UNASSIGNED PROPERTY','{}'),
      ('${properties[4]}','${otherOrg}','PRIVATE OTHER ORGANIZATION','{}');
    insert into public.lumaleasing_config(property_id,is_active,api_key)values
      ('${properties[0]}',true,'luma_${properties[0]}'),('${properties[1]}',false,'luma_${properties[1]}'),('${properties[3]}',true,'luma_${properties[3]}'),('${properties[4]}',true,'luma_${properties[4]}');
    insert into public.leads(id,org_id,property_id,first_name,last_name,email,phone,source)values
      ('${lead}','${org}','${properties[0]}','Taylor','Morgan','HIDDEN_CONTACT@private.invalid','PRIVATE_PHONE','organic'),
      ('${foreignLead}','${org}','${properties[3]}','PRIVATE','FOREIGN NAME','PRIVATE_FOREIGN_EMAIL','PRIVATE_FOREIGN_PHONE','organic');
    insert into public.conversations(id,property_id,lead_id,channel,created_at)values
      ('${chats[0]}','${properties[0]}','${lead}','widget',now()),
      ('${chats[1]}','${properties[1]}',null,'widget',now()-interval '2 days'),
      ('${chats[2]}','${properties[3]}','${foreignLead}','widget',now()),
      ('${chats[3]}','${properties[4]}',null,'widget',now()),
      ('${chats[4]}','${properties[0]}',null,'email',now()),
      ('${chats[5]}','${properties[0]}',null,'widget',now()-interval '200 days');
    insert into public.messages(conversation_id,role,content,created_at)values
      ('${chats[0]}','user','Do you have two-bedroom apartments available?',now()),
      ('${chats[0]}','assistant','Yes, I can help you explore our two-bedroom homes. What move-in date do you have in mind?',now()+interval '1 second'),
      ('${chats[0]}','user','Early November. Could I visit this Saturday?',now()+interval '2 seconds'),
      ('${chats[0]}','assistant','Our leasing team can help arrange a Saturday visit. Which time works best for you?',now()+interval '3 seconds'),
      ('${chats[0]}','system','PRIVATE SYSTEM INSTRUCTIONS',now()+interval '4 seconds'),
      ('${chats[2]}','user','PRIVATE UNASSIGNED TRANSCRIPT',now()),
      ('${chats[3]}','user','PRIVATE OTHER ORG TRANSCRIPT',now()),
      ('${chats[4]}','user','PRIVATE EMAIL THREAD',now()),
      ('${chats[5]}','user','An older visitor conversation.',now()-interval '200 days');
    insert into public.messages(conversation_id,role,content,created_at)select '${chats[1]}',case when n%2=0 then 'assistant'else'user'end,'Saved message '||lpad(n::text,3,'0'),now()-interval '2 days'+n*interval '1 second'from generate_series(1,205)n;
    insert into public.conversations(property_id,channel,created_at)select '${properties[0]}','widget',now()-n*interval '1 hour'from generate_series(1,25)n;
    commit;`);
  for (const [id, email, assignments] of [
    [client, clientEmail, properties.slice(0, 3)],
    [noChat, noChatEmail, [properties[2]]],
  ] as const) {
    const hash = createHash("sha256")
      .update(id + suffix)
      .digest("hex");
    expect(
      (
        await rpc("decide_client_access", {
          p_id: randomUUID(),
          p_actor_id: staff,
          p_input: {
            operation: "invite",
            name: "Alex Morgan",
            email,
            propertyIds: assignments,
          },
          p_token_hash: hash,
        })
      ).state,
    ).toBe("saved");
    expect(
      (
        await rpc("join_client_portal", {
          p_id: randomUUID(),
          p_actor_id: id,
          p_token_hash: hash,
          p_accept: true,
        })
      ).state,
    ).toBe("joined");
  }
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, clientEmail);
  await expect(
    page.getByRole("heading", { name: "Your leasing conversations." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Conversations", exact: true }),
  ).toBeVisible();
  const list = page.getByRole("region", { name: "Conversation list" });
  await expect(list.getByRole("link")).toHaveCount(25);
  await list.getByRole("link").filter({ hasText: "Taylor Morgan" }).click();
  const transcript = page.getByRole("region", {
    name: "Conversation transcript",
  });
  await expect(
    transcript.getByText("Do you have two-bedroom apartments available?"),
  ).toBeVisible();
  await expect(transcript.getByText("Leasing assistant / team")).toHaveCount(2);
  await expect(transcript.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByText("PRIVATE SYSTEM INSTRUCTIONS")).toHaveCount(0);
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("client-conversations-desktop.png"),
    fullPage: true,
  });
  const read = await page.request.get(
    `/api/client-portal/conversations?conversationId=${chats[0]}`,
  );
  expect(read.status()).toBe(200);
  expect(read.headers()["cache-control"]).toBe("private, no-store");
  expect(JSON.stringify(await read.json())).not.toMatch(
    /PRIVATE|HIDDEN_CONTACT|api_key|widget_session|human_agent|lead_id/,
  );
  for (const id of [chats[2], chats[3], chats[4]])
    expect(
      (
        await page.request.get(
          `/api/client-portal/conversations?conversationId=${id}`,
        )
      ).status(),
    ).toBe(404);
  expect(
    (
      await page.request.get(
        `/api/client-portal/conversations?propertyId=${properties[3]}`,
      )
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/client-portal/conversations", {
        data: { operation: "reply" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/lumaleasing/admin/conversation-work", {
        data: { operation: "takeover" },
      })
    ).status(),
  ).toBe(403);
  // Anonymous visitors retain a neutral name without exposing unrelated leads.
  const old = await page.request.get(
    `/api/client-portal/conversations?conversationId=${chats[5]}`,
  );
  expect(old.status()).toBe(200);
  expect((await old.json()).selected.visitor).toBe("Website visitor");
  await page.setViewportSize({ width: 390, height: 844 });
  await accessible(page);
  await page.screenshot({
    path: info.outputPath("client-conversations-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "All conversations", exact: true })
    .click();
  await expect(list).toBeVisible();
  await expect(transcript).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.getByRole("button", { name: "Next conversations" }).click();
  await expect(list.getByRole("link")).toHaveCount(3);
  await page
    .getByLabel("Property", { exact: true })
    .selectOption(properties[1]);
  await expect(list.getByRole("link")).toHaveCount(1);
  await expect(
    page.getByText("This chatbot is currently paused.", { exact: false }),
  ).toBeVisible();
  await list.getByRole("link").click();
  await expect(
    transcript.getByText("Saved message 205", { exact: true }),
  ).toBeAttached();
  await expect(
    transcript.getByText("Saved message 001", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Earlier messages" }).click();
  await expect(
    transcript.getByText("Saved message 001", { exact: true }),
  ).toBeVisible();
  await expect(
    transcript.getByText("Saved message 006", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Latest messages" }).click();
  await expect(
    transcript.getByText("Saved message 205", { exact: true }),
  ).toBeAttached();
  await page.getByLabel("Conversations started").selectOption("7");
  await page
    .getByLabel("Property", { exact: true })
    .selectOption(properties[0]);
  const period = await page.request.get(
    `/api/client-portal/conversations?propertyId=${properties[0]}&days=7&offset=25`,
  );
  expect(
    (await period.json()).conversations.some(
      (c: { id: string }) => c.id === chats[5],
    ),
  ).toBe(false);
  // Failure must replace the transcript, and retry must reload it.
  await list.getByRole("link").filter({ hasText: "Taylor Morgan" }).click();
  await expect(
    transcript.getByText("Early November. Could I visit this Saturday?"),
  ).toBeVisible();
  await page.route("**/api/client-portal/conversations?**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Conversations are temporarily unavailable.",
      }),
    }),
  );
  await page.getByRole("button", { name: "Refresh conversations" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "temporarily unavailable",
  );
  await expect(
    page.getByText("Early November. Could I visit this Saturday?"),
  ).toHaveCount(0);
  await page.unroute("**/api/client-portal/conversations?**");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    transcript.getByText("Early November. Could I visit this Saturday?"),
  ).toBeVisible();
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await login(other, noChatEmail);
  await expect(
    other.getByRole("heading", { name: "No chatbot conversations yet" }),
  ).toBeVisible();
  await expect(
    other.getByRole("link", { name: "Conversations", exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await other.request.get(
        `/api/client-portal/conversations?conversationId=${chats[0]}`,
      )
    ).status(),
  ).toBe(404);
  await otherContext.close();
  // Current-session access changes apply to the history endpoint too.
  let roster = await rpc("read_client_access", { p_actor_id: staff });
  let account = roster.accounts.find((a: { id: string }) => a.id === client);
  expect(
    (
      await rpc("decide_client_access", {
        p_id: randomUUID(),
        p_actor_id: staff,
        p_input: {
          operation: "update",
          targetId: client,
          revision: account.revision,
          propertyIds: [properties[1], properties[2]],
        },
      })
    ).state,
  ).toBe("saved");
  await page.getByRole("button", { name: "Refresh conversations" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(
    page.getByText("Early November. Could I visit this Saturday?"),
  ).toHaveCount(0);
  expect(
    (
      await page.request.get(
        `/api/client-portal/conversations?conversationId=${chats[0]}`,
      )
    ).status(),
  ).toBe(404);
  roster = await rpc("read_client_access", { p_actor_id: staff });
  account = roster.accounts.find((a: { id: string }) => a.id === client);
  expect(
    (
      await rpc("decide_client_access", {
        p_id: randomUUID(),
        p_actor_id: staff,
        p_input: {
          operation: "revoke",
          targetId: client,
          revision: account.revision,
        },
      })
    ).state,
  ).toBe("saved");
  expect(
    (await page.request.get("/api/client-portal/conversations")).status(),
  ).toBe(403);
  // Restore this synthetic account for a reviewable local example.
  roster = await rpc("read_client_access", { p_actor_id: staff });
  account = roster.accounts.find((a: { id: string }) => a.id === client);
  expect(
    (
      await rpc("decide_client_access", {
        p_id: randomUUID(),
        p_actor_id: staff,
        p_input: {
          operation: "update",
          targetId: client,
          revision: account.revision,
          propertyIds: properties.slice(0, 3),
        },
      })
    ).state,
  ).toBe("saved");
  expect(errors).toEqual([]);
});
