import { test, expect } from "@playwright/test";
test("RTL import dashboard shows durable progress, filters and pause/resume controls", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "حساب ندارید؟ ثبت‌نام کنید" }).click();
  await page.getByLabel("نام شما", { exact: true }).fill("مدیر واردسازی");
  await page.getByLabel("نام کسب‌وکار").fill("کاتالوگ آزمایشی");
  await page
    .getByLabel("ایمیل", { exact: true })
    .fill("imports-" + crypto.randomUUID() + "@example.com");
  await page
    .getByLabel("رمز عبور (حداقل ۱۰ کاراکتر)")
    .fill("Import-Browser-2026!");
  await page.getByRole("button", { name: "ساخت فضای کاری" }).click();
  await expect(page.getByRole("heading", { name: /سلام مدیر/ })).toBeVisible();
  let paused = false;
  const controls: any[] = [];
  const now = new Date().toISOString();
  // UI fixture only: backend import behavior is covered by database-backed service tests.
  await page.route("**/api/imports", (route) =>
    route.fulfill({
      json: {
        stores: [
          {
            id: "store-fixture",
            name: "فروشگاه تست رابط",
            domain: "https://fixture.example.com",
            platform: "woocommerce",
            interval_minutes: 30,
            paused,
            last_success_at: now,
            next_sync_at: now,
            product_count: 2505,
            awaiting_match: 30,
          },
        ],
        runs: [
          {
            id: "run",
            store_id: "store-fixture",
            status: paused ? "paused" : "running",
            processed: 1500,
            new_count: 1200,
            updated_count: 100,
            unchanged_count: 200,
            failed_count: 0,
            total_estimate: 2505,
            started_at: now,
          },
        ],
        errors: [],
        matchingAvailable: false,
        competitorAvailable: false,
      },
    }),
  );
  await page.route("**/api/imports/control", (route) => {
    const body = route.request().postDataJSON();
    controls.push(body);
    paused = body.action === "pause";
    return route.fulfill({ json: { ok: true } });
  });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "فروشگاه‌ها" })
    .click();
  await expect(
    page.getByText("فروشگاه تست رابط", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "60",
  );
  await page.getByRole("button", { name: "توقف", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "ادامه", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ادامه", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "توقف", exact: true }),
  ).toBeVisible();
  expect(controls.map((c) => c.action)).toEqual(["pause", "resume"]);
  await page.getByLabel("جستجوی اتصال").fill("پیدا نمی‌شود");
  await expect(
    page.getByText("فروشگاه تست رابط", { exact: true }),
  ).not.toBeVisible();
  await page.getByLabel("جستجوی اتصال").fill("");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: ".data/imports-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "یک اتصال؛ همیشه به‌روز." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: ".data/imports-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});
test("connection wizard explains unsupported access and never echoes API credentials", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "حساب ندارید؟ ثبت‌نام کنید" }).click();
  await page.getByLabel("نام شما", { exact: true }).fill("آزمایش اتصال");
  await page.getByLabel("نام کسب‌وکار").fill("فروشگاه آزمون");
  await page
    .getByLabel("ایمیل", { exact: true })
    .fill("wizard-" + crypto.randomUUID() + "@example.com");
  await page
    .getByLabel("رمز عبور (حداقل ۱۰ کاراکتر)")
    .fill("Wizard-Browser-2026!");
  await page.getByRole("button", { name: "ساخت فضای کاری" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "فروشگاه‌ها" })
    .click();
  await page
    .getByRole("button", { name: "افزودن فروشگاه", exact: true })
    .click();
  await page.getByLabel("پلتفرم فروشگاه").selectOption("sazito");
  await expect(page.getByText(/API رسمی کاتالوگ سازیتو/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "آزمون اتصال و واردسازی خودکار" }),
  ).not.toBeVisible();
  await page.getByLabel("پلتفرم فروشگاه").selectOption("woocommerce");
  await expect(
    page.getByLabel("Consumer key", { exact: true }),
  ).toHaveAttribute("type", "password");
  await expect(
    page.getByLabel("Consumer secret", { exact: true }),
  ).toHaveAttribute("type", "password");
  await page.getByLabel("پلتفرم فروشگاه").selectOption("custom");
  await expect(page.getByLabel("نگاشت JSON")).toBeVisible();
});
