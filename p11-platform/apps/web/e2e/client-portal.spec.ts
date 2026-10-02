import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import axe from "axe-core";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
  baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:9440",
  password = "P11-local-preview-fixture-2026!";
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
async function login(page: Page, email: string, target: string) {
  await page.goto("/auth/login?redirect=" + encodeURIComponent(target));
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(target.replaceAll("/", "\/")), {
    timeout: 45000,
  });
}
async function accessibility(
  page: Page,
  label: string,
  output: (name: string) => string,
) {
  await page.evaluate(axe.source);
  const result = await page.evaluate(
    async () =>
      await (window as unknown as { axe: typeof axe }).axe.run(
        { exclude: ["nextjs-portal"] },
        { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } },
      ),
  );
  await writeFile(
    output(label + "-accessibility.json"),
    JSON.stringify(result.violations, null, 2),
  );
  expect(result.violations, label + " accessibility violations").toEqual([]);
  return result.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.length,
  }));
}
test("staff invite clients into assigned-property reporting; client sessions cannot manage the console", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240000);
  if (
    !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
    !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)
  )
    throw Error("Local test fixtures only");
  const suffix = randomUUID(),
    staffEmail = "portal-staff-" + suffix + "@p11.test",
    clientEmail = "portal-client-" + suffix + "@p11.test",
    org = randomUUID(),
    otherOrg = randomUUID(),
    properties = Array.from({ length: 4 }, () => randomUUID());
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
  const fixture = {
    staffId,
    clientId,
    staffEmail,
    clientEmail,
    org,
    otherOrg,
    properties,
  };
  await writeFile(
    info.outputPath("fixture.json"),
    JSON.stringify(fixture, null, 2),
  );
  sql(
    `BEGIN;INSERT INTO public.organizations(id,name)VALUES('${org}','Design review fixture'),('${otherOrg}','Other design fixture');SELECT set_config('p11.team_scope','${org}',true);UPDATE public.profiles SET org_id='${org}',role='admin',full_name='P11 preview team'WHERE id='${staffId}';INSERT INTO public.properties(id,org_id,name,address)VALUES('${properties[0]}','${org}','Harbor House (preview)','{"street":"120 Harbor Way","city":"Portland","state":"OR","zip":"97201"}'),('${properties[1]}','${org}','Juniper Place (preview)','{"street":"45 Juniper Lane","city":"Portland","state":"OR","zip":"97205"}'),('${properties[2]}','${org}','Unassigned private property','{}'),('${properties[3]}','${otherOrg}','Other organization property','{}');INSERT INTO public.fact_marketing_performance(property_id,date,channel_id,source_account_id,currency_code,campaign_id,campaign_name,impressions,clicks,spend,conversions)SELECT '${properties[0]}',current_date-n,'google_ads','1234567890','USD','private-campaign-id','PRIVATE CAMPAIGN TITLE',1200+n*23,45+(n%7)*9,45.75+n,3+(n%3)FROM generate_series(0,29)n;INSERT INTO public.fact_marketing_performance(property_id,date,channel_id,source_account_id,currency_code,campaign_id,campaign_name,impressions,clicks,spend,conversions)SELECT '${properties[1]}',current_date-n,'meta_ads','1234567890','USD','private-campaign-id','PRIVATE CAMPAIGN TITLE',750+n*11,22+(n%5)*6,28.50+n,1+(n%2)FROM generate_series(0,29)n;INSERT INTO public.leads(property_id,first_name,last_name,email,source)SELECT '${properties[0]}','Private','Visitor','visitor-'||n||'@private.invalid','manual'FROM generate_series(1,18)n;COMMIT;`,
  );
  const clientContext = await browser.newContext(),
    clientPage = await clientContext.newPage();
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  clientPage.on("pageerror", (e) => failures.push(e.message));
  // Save an actual report using the existing staff workflow.
  await login(page, staffEmail, "/dashboard/bi");
  const reportRegion = page.getByRole("region", {
    name: "Saved marketing reports",
  });
  await expect(
    reportRegion.getByRole("button", { name: "Refresh saved reports" }),
  ).toBeEnabled({ timeout: 45000 });
  await reportRegion
    .getByLabel("Report name")
    .fill("September marketing review");
  await reportRegion
    .getByRole("button", { name: "Save current report" })
    .click();
  await expect(reportRegion.getByRole("status")).toContainText("Report saved");
  // Saving an internal BI snapshot does not publish it to clients.
  const priorMonth = new Date();
  priorMonth.setUTCDate(1);
  priorMonth.setUTCMonth(priorMonth.getUTCMonth() - 1);
  const deliveryDecision = async (input: Record<string, unknown>) => {
    const response = await page.request.post("/api/delivery", {
      headers: { origin: new URL(baseURL).origin },
      data: {
        requestId: randomUUID(),
        expectedActorId: staffId,
        propertyId: properties[0],
        input,
      },
    });
    expect(response.status()).toBe(200);
    return response.json();
  };
  const clientDraft = await deliveryDecision({
    operation: "report_draft",
    month: priorMonth.toISOString().slice(0, 7),
  });
  await deliveryDecision({
    operation: "report_edit",
    targetId: clientDraft.targetId,
    revision: 1,
    summary: "Reviewed marketing performance for this property.",
    nextSteps: "Review the next month of results with your P11 team.",
  });
  await deliveryDecision({
    operation: "report_transition",
    targetId: clientDraft.targetId,
    revision: 2,
    status: "approved",
  });
  await deliveryDecision({
    operation: "report_transition",
    targetId: clientDraft.targetId,
    revision: 3,
    status: "published",
  });
  await page.goto("/dashboard/clients");
  await page
    .getByRole("button", { name: "Invite client", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Client name").fill("Alex Morgan");
  await dialog.getByLabel("Email address").fill(clientEmail);
  await dialog.getByLabel("Harbor House (preview)", { exact: true }).check();
  await dialog.getByLabel("Juniper Place (preview)", { exact: true }).check();
  await dialog.getByRole("button", { name: "Create invitation" }).click();
  await expect(dialog.getByRole("heading")).toHaveText(
    "Your invitation is ready",
  );
  const link = await dialog.getByLabel("Private invitation link").inputValue();
  expect(link).toContain("/join/client#token=");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await clientPage.goto(link);
  await expect(
    clientPage.getByRole("link", { name: "Sign in to continue" }),
  ).toBeVisible();
  await expect(clientPage).toHaveURL(baseURL + "/join/client");
  await clientPage.getByRole("link", { name: "Sign in to continue" }).click();
  await clientPage.getByLabel("Email address").fill(clientEmail);
  await clientPage.getByLabel("Password", { exact: true }).fill(password);
  await clientPage
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(
    clientPage.getByRole("button", { name: "Open my workspace" }),
  ).toBeVisible({ timeout: 45000 });
  await clientPage.getByRole("button", { name: "Open my workspace" }).click();
  await expect(clientPage).toHaveURL(baseURL + "/client");
  await expect(
    clientPage.getByRole("heading", {
      name: "A clearer view of your properties.",
    }),
  ).toBeVisible();
  await expect(
    clientPage.getByText("Alex Morgan", { exact: true }),
  ).toBeVisible();
  const overview = await clientPage.request.get("/api/client-portal/overview");
  expect(overview.status()).toBe(200);
  const body = await overview.json();
  expect(body.properties.map((p: { id: string }) => p.id).sort()).toEqual(
    properties.slice(0, 2).sort(),
  );
  expect(body.inquiries).toBe(18);
  expect(body.reports).toHaveLength(1);
  for (const secret of [
    "1234567890",
    "PRIVATE CAMPAIGN TITLE",
    "@private.invalid",
    properties[2],
    properties[3],
  ])
    expect(JSON.stringify(body)).not.toContain(secret);
  await clientPage.setViewportSize({ width: 1440, height: 1000 });
  await clientPage.screenshot({
    path: info.outputPath("client-overview-desktop.png"),
    fullPage: true,
  });
  await writeFile(
    info.outputPath("client-a11y-summary.json"),
    JSON.stringify(
      await accessibility(
        clientPage,
        "client-desktop",
        info.outputPath.bind(info),
      ),
    ),
  );
  await clientPage
    .getByLabel("Property", { exact: true })
    .selectOption(properties[0]);
  await expect(
    clientPage.getByRole("heading", {
      name: "Harbor House (preview)",
      exact: true,
    }),
  ).toBeVisible();
  await clientPage.getByLabel("Reporting period").selectOption("7");
  await expect(clientPage).toHaveURL(
    new RegExp(
      "propertyId=" +
        properties[0] +
        ".*days=7|days=7.*propertyId=" +
        properties[0],
    ),
  );
  await expect
    .poll(async () => {
      const r = await clientPage.request.get(
        "/api/client-portal/overview?days=7&propertyId=" + properties[0],
      );
      return (await r.json()).period.days;
    })
    .toBe(7);
  for (const path of [
    "/api/leads?propertyId=" + properties[0],
    "/api/client-portal/access",
    "/api/client-portal/overview?propertyId=" + properties[2],
    "/api/client-portal/overview?propertyId=" + properties[3],
  ])
    expect((await clientPage.request.get(path)).status()).toBe(403);
  expect(
    (
      await clientPage.request.post("/api/client-portal/access", {
        headers: { origin: baseURL },
        data: { operation: "invite" },
      })
    ).status(),
  ).toBe(403);
  await clientPage.goto("/dashboard/leads");
  await expect(clientPage).toHaveURL(baseURL + "/client");
  await expect(
    clientPage.getByRole("navigation", { name: "Client navigation" }),
  ).toBeVisible();
  await clientPage
    .getByRole("link", { name: "Performance", exact: true })
    .click();
  await expect(
    clientPage.getByRole("heading", {
      name: "Performance, in perspective.",
      exact: true,
    }),
  ).toBeVisible();
  await clientPage
    .getByRole("link", { name: "Properties", exact: true })
    .click();
  await expect(
    clientPage.getByRole("heading", {
      name: "Your property portfolio.",
      exact: true,
    }),
  ).toBeVisible();
  await clientPage.getByRole("link", { name: "Reports", exact: true }).click();
  await clientPage.getByRole("button", { name: "View report" }).click();
  const reportDialog = clientPage.getByRole("dialog", {
    name: /Client report/,
  });
  await expect(reportDialog).toBeVisible();
  const downloadPromise = clientPage.waitForEvent("download");
  await reportDialog.getByRole("button", { name: "Download summary" }).click();
  const download = await downloadPromise;
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain("Client report");
  expect(csv).toContain("\r\n");
  expect(csv).not.toContain("1234567890");
  await clientPage.keyboard.press("Escape");
  await expect(reportDialog).toHaveCount(0);
  await clientPage.setViewportSize({ width: 390, height: 844 });
  await clientPage.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(clientPage).toHaveURL(baseURL + "/client");
  await expect(
    clientPage.getByRole("heading", {
      name: "A clearer view of your properties.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    clientPage.getByText("Alex Morgan", { exact: true }),
  ).toHaveCount(1);
  await expect.poll(() => clientPage.getByRole("status").count()).toBe(0);
  expect(
    await clientPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await clientPage.screenshot({
    path: info.outputPath("client-overview-mobile.png"),
    fullPage: true,
  });
  await accessibility(clientPage, "client-mobile", info.outputPath.bind(info));
  // A failed data read must not masquerade as zero results.
  await clientPage.route("**/api/client-portal/overview*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Results temporarily unavailable." }),
    }),
  );
  await clientPage.getByRole("button", { name: "Refresh results" }).click();
  await expect(
    clientPage.locator('.console-error[role="alert"]'),
  ).toContainText("Results temporarily unavailable.");
  await expect(clientPage.getByText("18", { exact: true })).toHaveCount(0);
  await clientPage.unroute("**/api/client-portal/overview*");
  await clientPage.getByRole("button", { name: "Try again" }).click();
  await expect(clientPage.locator('.console-error[role="alert"]')).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("button", { name: "Edit properties" }).click();
  await dialog.getByLabel("Juniper Place (preview)", { exact: true }).uncheck();
  await dialog.getByRole("button", { name: "Save access" }).click();
  await expect(dialog).not.toBeVisible();
  expect(
    (
      await clientPage.request.get(
        "/api/client-portal/overview?propertyId=" + properties[1],
      )
    ).status(),
  ).toBe(403);
  await page
    .getByRole("button", { name: "Remove access", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Remove access", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(
    (await clientPage.request.get("/api/client-portal/overview")).status(),
  ).toBe(403);
  await clientPage.reload();
  await expect(
    clientPage.locator('.console-error[role="alert"]'),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore access" }).click();
  await dialog.getByRole("button", { name: "Save access" }).click();
  await expect(dialog).not.toBeVisible();
  await clientPage.getByRole("button", { name: "Try again" }).click();
  await expect(clientPage.locator('.console-error[role="alert"]')).toHaveCount(
    0,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Property overview", exact: true }),
  ).toBeVisible();
  await expect.poll(() => page.locator(".animate-pulse").count()).toBe(0);
  await page.screenshot({
    path: info.outputPath("internal-overview-desktop.png"),
    fullPage: true,
  });
  await writeFile(
    info.outputPath("internal-a11y-summary.json"),
    JSON.stringify(
      await accessibility(page, "internal-desktop", info.outputPath.bind(info)),
    ),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath("internal-overview-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await accessibility(page, "internal-mobile", info.outputPath.bind(info));
  await page.getByText("Navigation", { exact: true }).click();
  await page.getByRole("link", { name: "Client access", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Client access", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("client-access-mobile.png"),
    fullPage: true,
  });
  await writeFile(
    info.outputPath("page-errors.json"),
    JSON.stringify(failures),
  );
  expect(failures).toEqual([]);
  await clientPage
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(clientPage).toHaveURL(baseURL + "/auth/login");
  await clientPage.goto("/client");
  await expect(clientPage).toHaveURL(/\/auth\/login/);
  await clientContext.close();
  // Retained synthetic fixture IDs support visual review and explicit scoped cleanup.
});
