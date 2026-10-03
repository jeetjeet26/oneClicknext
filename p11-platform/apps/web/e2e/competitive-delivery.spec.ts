import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import axe from "axe-core";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
  base = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:9430";
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const password = "Local-delivery-fixture-2026!";
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
async function login(page: Page, email: string, target: string) {
  await page.goto("/auth/login?redirect=" + encodeURIComponent(target));
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(target), { timeout: 60000 });
}
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  expect(error).toBeNull();
  return data;
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
    violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}
test("reporting keeps Basecamp tasks separate and publishes only reviewed client reports", async ({
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
    property = randomUUID(),
    hidden = randomUUID(),
    lead = randomUUID();
  const staffEmail = `delivery-staff-${suffix}@p11.test`,
    clientEmail = `delivery-client-${suffix}@p11.test`;
  const staff = await db.auth.admin.createUser({
      email: staffEmail,
      password,
      email_confirm: true,
    }),
    client = await db.auth.admin.createUser({
      email: clientEmail,
      password,
      email_confirm: true,
    });
  expect(staff.error).toBeNull();
  expect(client.error).toBeNull();
  const staffId = staff.data.user!.id,
    clientId = client.data.user!.id;
  await writeFile(
    info.outputPath("fixture.json"),
    JSON.stringify(
      {
        org,
        property,
        hidden,
        lead,
        staffId,
        clientId,
        staffEmail,
        clientEmail,
      },
      null,
      2,
    ),
  );
  sql(
    `begin;insert into public.organizations(id,name)values('${org}','Competitive delivery fixture');select set_config('p11.team_scope','${org}',true);update public.profiles set org_id='${org}',role='admin',full_name='P11 delivery reviewer'where id='${staffId}';insert into public.properties(id,org_id,name,address)values('${property}','${org}','Harbor House — delivery preview','{"city":"Portland","state":"OR"}'),('${hidden}','${org}','Unassigned confidential property','{}');insert into public.leads(id,property_id,org_id,first_name,last_name,email,source,created_at)values('${lead}','${property}','${org}','Taylor','Preview','private-prospect@fixture.invalid','organic',current_date-10);insert into public.fact_marketing_performance(property_id,date,channel_id,source_account_id,currency_code,campaign_id,campaign_name,impressions,clicks,spend,conversions)select '${property}',current_date-n,'google_ads','1234567890','USD','private-campaign','PRIVATE CAMPAIGN',1000,40,35,2 from generate_series(1,59)n;commit;notify pgrst,'reload schema';`,
  );
  const invitation = randomUUID(),
    token = createHash("sha256").update(suffix).digest("hex");
  expect(
    (
      await rpc("decide_client_access", {
        p_id: invitation,
        p_actor_id: staffId,
        p_input: {
          operation: "invite",
          name: "Alex Morgan",
          email: clientEmail,
          propertyIds: [property],
        },
        p_token_hash: token,
      })
    ).state,
  ).toBe("saved");
  expect(
    (
      await rpc("join_client_portal", {
        p_id: randomUUID(),
        p_actor_id: clientId,
        p_token_hash: token,
        p_accept: true,
      })
    ).state,
  ).toBe("joined");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, staffEmail, "/dashboard/delivery");
  await expect(
    page.getByRole("heading", {
      name: "Client reporting & outcomes.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Internal workspace · Clients see published reports only"),
  ).toBeVisible({ timeout: 60000 });
  await expect(
    page.getByRole("heading", { name: "A monthly report, ready for review" }),
  ).toBeVisible();
  await expect(
    page.getByText("Manage projects, assignments and deadlines in Basecamp.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Work & priorities", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Quality & effort", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Work title", { exact: true })).toHaveCount(0);
  const retired = await page.request.post("/api/delivery", {
    headers: { origin: new URL(base).origin },
    data: {
      requestId: randomUUID(),
      expectedActorId: staffId,
      propertyId: property,
      input: {
        operation: "work_transition",
        targetId: randomUUID(),
        revision: 1,
        status: "review",
        nextStep: "Review in Basecamp",
        evidenceId: null,
      },
    },
  });
  expect(retired.status()).toBe(410);
  await page.screenshot({
    path: info.outputPath("internal-reporting.png"),
    fullPage: true,
  });
  await accessible(page);
  await page
    .getByRole("button", { name: "Leasing outcomes", exact: true })
    .click();
  const outcome = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Record a leasing outcome" }),
  });
  await outcome.getByLabel("Inquiry", { exact: true }).selectOption(lead);
  await outcome.getByLabel("Outcome", { exact: true }).selectOption("lease");
  await outcome
    .getByLabel("Outcome date")
    .fill(new Date(Date.now() - 86400000).toISOString().slice(0, 10));
  await outcome
    .getByLabel("Source reference")
    .fill("Reviewed leasing report, September");
  let lost = false;
  await page.route("**/api/delivery", async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postDataJSON().input.operation === "outcomes" &&
      !lost
    ) {
      lost = true;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await outcome
    .getByRole("button", { name: "Save outcome", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Confirm the earlier request" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Check saved result" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check saved result" }).click();
  await expect(page.getByRole("status")).toContainText(
    "earlier decision was saved",
  );
  await page
    .getByRole("button", { name: "Leasing outcomes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Taylor Preview · Lease signed" }),
  ).toBeVisible();
  const recorded = page.locator("article").filter({
    has: page.getByRole("heading", { name: "Taylor Preview · Lease signed" }),
  });
  await recorded.getByText("Correct or withdraw this outcome").click();
  await recorded
    .getByLabel("Reason for correction")
    .fill("Corrected the source reference after review");
  await recorded
    .getByLabel("Source reference")
    .fill("Leasing report row 23, reviewed");
  await recorded.getByRole("button", { name: "Save correction" }).click();
  await expect(recorded.getByText("Staff report · revision 2")).toBeVisible();
  expect(
    (
      await db
        .from("delivery_outcomes")
        .select("id")
        .eq("property_id", property)
    ).data,
  ).toHaveLength(1);
  await page.screenshot({
    path: info.outputPath("internal-outcomes.png"),
    fullPage: true,
  });
  await accessible(page);
  const clientContext = await browser.newContext(),
    clientPage = await clientContext.newPage();
  clientPage.setDefaultTimeout(20000);
  clientPage.on("pageerror", (e) => errors.push(e.message));
  await login(clientPage, clientEmail, "/client");
  const initial = await (
    await clientPage.request.get("/api/client-portal/overview")
  ).json();
  expect(initial.reports).toHaveLength(0);
  expect(initial.funnel.leases).toBe(1);
  expect(initial.properties.map((p: { id: string }) => p.id)).toEqual([
    property,
  ]);
  expect(
    (
      await clientPage.request.get("/api/delivery?propertyId=" + property)
    ).status(),
  ).toBe(403);
  await page
    .getByRole("button", { name: "Client reports", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Prepare monthly draft", exact: true })
    .click();
  const card = page.locator("article").filter({
    has: page.getByText("What the results mean for your client", {
      exact: true,
    }),
  });
  await expect(card).toBeVisible();
  await card
    .getByLabel("What the results mean for your client")
    .fill(
      "Marketing reached more prospective residents this month. One lease was reported and reviewed by our team.",
    );
  await card
    .getByLabel("Next steps for the coming month")
    .fill("Review inquiry quality and improve the website follow-up journey.");
  await card.getByRole("button", { name: "Save report narrative" }).click();
  await expect(
    card.getByRole("button", { name: "Approve this version" }),
  ).toBeEnabled();
  expect(
    (await (await clientPage.request.get("/api/client-portal/overview")).json())
      .reports,
  ).toHaveLength(0);
  await card.getByRole("button", { name: "Approve this version" }).click();
  await expect(
    card.getByRole("button", { name: "Publish to assigned clients" }),
  ).toBeEnabled();
  await card
    .getByRole("button", { name: "Publish to assigned clients" })
    .click();
  await expect(
    page.locator("article").getByText("published", { exact: true }),
  ).toBeVisible();
  const published = await (
    await clientPage.request.get("/api/client-portal/overview")
  ).json();
  expect(published.reports).toHaveLength(1);
  for (const secret of [
    "1234567890",
    "PRIVATE CAMPAIGN",
    "private-prospect@fixture.invalid",
    hidden,
  ])
    expect(JSON.stringify(published)).not.toContain(secret);
  await page.screenshot({
    path: info.outputPath("internal-report-review.png"),
    fullPage: true,
  });
  await accessible(page);
  await clientPage.reload();
  await expect(
    clientPage.getByRole("heading", { name: "How this period compares" }),
  ).toBeVisible();
  await clientPage.screenshot({
    path: info.outputPath("client-results.png"),
    fullPage: true,
  });
  await accessible(clientPage);
  await clientPage.getByRole("link", { name: "Reports", exact: true }).click();
  await expect(clientPage).toHaveURL(/\/client\/reports$/);
  await expect(
    clientPage.getByRole("heading", { name: "Your reporting library." }),
  ).toBeVisible();
  await clientPage.getByRole("button", { name: "View report" }).click();
  await expect(clientPage.getByRole("dialog")).toContainText(
    "One lease was reported and reviewed",
  );
  await clientPage.screenshot({
    path: info.outputPath("client-published-report.png"),
    fullPage: true,
  });
  await accessible(clientPage);
  await clientPage.getByRole("button", { name: "Close report" }).click();
  await clientPage.setViewportSize({ width: 390, height: 844 });
  await clientPage.goto("/client");
  await expect(
    clientPage.getByRole("heading", { name: "How this period compares" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      clientPage.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    )
    .toBe(true);
  await clientPage.screenshot({
    path: info.outputPath("client-mobile.png"),
    fullPage: true,
  });
  await accessible(clientPage);
  await page
    .locator("article")
    .getByRole("button", { name: "Withdraw report", exact: true })
    .click();
  await expect(
    page.locator("article").getByText("withdrawn", { exact: true }),
  ).toBeVisible();
  expect(
    (await (await clientPage.request.get("/api/client-portal/overview")).json())
      .reports,
  ).toHaveLength(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: info.outputPath("internal-mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await clientContext.close();
});
