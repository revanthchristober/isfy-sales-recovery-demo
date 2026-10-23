import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test.use({ video: "on" });

test("a visitor can recover a fake cart, reload, and keep another visitor separate", async ({ page, browser }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Turn missed checkouts into conversations." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Add fake cart/ })).toBeEnabled();
  await page.waitForTimeout(8_000);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await page.locator(".lead-card").filter({ hasText: "Eligible to contact" }).count()) break;
    await page.getByRole("button", { name: /Add fake cart/ }).click();
    await expect(page.locator(".count-pill")).not.toHaveText("0 leads");
  }
  await page.waitForTimeout(8_000);

  const lead = page.locator(".lead-card").filter({ hasText: "Eligible to contact" }).first();
  await expect(lead).toBeVisible();
  const cartAmount = await lead.locator(".cart-amount").innerText();
  await lead.getByRole("button", { name: "Claim lead" }).click();
  await expect(lead.locator(".lead-status")).toHaveText("claimed");
  await page.waitForTimeout(8_000);
  await lead.getByRole("button", { name: "Simulate sale" }).click();
  await expect(page.getByRole("status")).toHaveText("Simulated sale recorded.");
  await expect(page.locator(".revenue-card strong")).toHaveText(cartAmount);
  await page.waitForTimeout(8_000);

  await page.reload();
  const recoveredLead = page.locator(".lead-card").filter({ hasText: "Recovered sale" }).first();
  await expect(recoveredLead).toBeVisible();
  await expect(recoveredLead.locator(".lead-status")).toHaveText("recovered");
  await page.waitForTimeout(8_000);
  const revenueAfterReload = await page.locator(".revenue-card strong").innerText();
  await recoveredLead.getByRole("button", { name: "Try repeated sale" }).click();
  await expect(page.getByRole("status")).toHaveText("Repeated sale ignored.");
  await expect(page.locator(".revenue-card strong")).toHaveText(revenueAfterReload);
  await page.waitForTimeout(8_000);

  if (process.env.CAPTURE_DEMO_SCREENSHOT) {
    await mkdir("artifacts", { recursive: true });
    await page.screenshot({ path: "artifacts/demo-workflow.png", fullPage: true });
  }

  const secondVisitor = await browser.newContext();
  const secondPage = await secondVisitor.newPage();
  await secondPage.goto("/");
  await expect(secondPage.getByRole("heading", { name: "Your inbox is ready" })).toBeVisible();
  await expect(secondPage.locator(".count-pill")).toHaveText("0 leads");
  await expect(secondPage.locator(".revenue-card strong")).toHaveText("$0.00");
  await page.waitForTimeout(8_000);
  await secondVisitor.close();
});
