import { expect, test, type Page } from "@playwright/test";

/**
 * Runs against a seeded database (`npm run db:seed`). Each test creates its own job, so the
 * suite can be re-run without reseeding.
 */
async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Relay@123");
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function createJob(page: Page, reference: string) {
  await page.goto("/jobs/new");
  await page.getByLabel("Order reference").fill(reference);
  await page.getByLabel("Customer").fill("E2E Customer");
  await page.getByLabel("Pickup zone").selectOption("CENTRAL");
  await page.getByLabel("Delivery zone").selectOption("NORTH");
  await page.getByLabel("Load (capacity units)").fill("1");
  await page.getByRole("button", { name: "Create job" }).click();
  await expect(page.getByRole("heading", { name: reference })).toBeVisible();
}

test("dispatcher assigns the recommended rider and the job is delivered", async ({ page }) => {
  const reference = `E2E-${Date.now()}`;
  await signIn(page, "dispatcher@relay.dev");
  await expect(page.getByRole("heading", { name: "Dispatch overview" })).toBeVisible();

  await createJob(page, reference);
  await expect(page.getByText("Ready", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Assign" }).first().click();
  await page.getByRole("button", { name: "Assign recommended rider" }).click();
  await expect(page.getByText("Awaiting rider").first()).toBeVisible();
  await expect(page.getByText("Confirm within", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Rider accepts" }).click();
  await page.getByRole("button", { name: "Mark picked up" }).click();
  await page.getByRole("button", { name: "Mark delivered" }).click();
  await expect(page.getByText("Delivered").first()).toBeVisible();

  const timeline = page.locator("li");
  for (const entry of ["Job created", "Rider assigned", "Rider confirmed", "Picked up", "Delivered"]) {
    await expect(timeline.filter({ hasText: entry }).first()).toBeVisible();
  }
});

test("unauthenticated users are sent to login and the API refuses them", async ({ page, request }) => {
  await page.goto("/manual-queue");
  await expect(page).toHaveURL(/\/login/);
  const res = await request.get("/api/jobs");
  expect(res.status()).toBe(401);
});

test("riders only see the rider app", async ({ page }) => {
  await signIn(page, "arjun@relay.dev");
  await expect(page).toHaveURL(/\/rider/);
  await page.goto("/jobs");
  await expect(page).toHaveURL(/\/rider/);
});
