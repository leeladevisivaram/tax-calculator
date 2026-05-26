import { expect, test } from "@playwright/test";
import { clickAction, fillSalaryScenario, goToStep, openCalculator, runCompute } from "./helpers.mjs";

test.describe("Feature: React UX upgrade", () => {
  test("opens directly to the Choice Hub and routes selected choices into the calculator", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("landing-hero")).toBeVisible();
    await expect(page.getByTestId("api-status")).toContainText("API connected");

    await expect(page.getByTestId("choice-hub")).toBeVisible();
    await expect(page.getByTestId("choice-card")).toHaveCount(7);
    await expect(page.getByRole("heading", { name: "Choose how you want to start" })).toBeVisible();

    await page.getByTestId("choice-card").filter({ hasText: "Salaried" }).click();

    await expect(page.getByTestId("panel-income")).toBeVisible();
    await expect(page.getByTestId("guided-checklist")).toContainText("Salaried checklist");
    await expect(page.locator('[name="income_head_salary"]')).toBeChecked();
  });

  test("moves application details into the About tab with AY source references", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("api-status")).toContainText("API connected");

    await page.getByTestId("about-tab").click();

    await expect(page.getByRole("heading", { name: "Application details and tax coverage" })).toBeVisible();
    await page.getByRole("button", { name: "Coverage" }).click();
    await expect(page.getByTestId("about-tax-coverage")).toContainText("AY 2026-27");
    await expect(page.getByTestId("about-tax-coverage")).toContainText("default new-regime");
    await expect(page.getByText("Data storage behavior")).toBeVisible();
    await expect(page.getByText("localStorage")).toBeVisible();

    await page.getByRole("button", { name: "Sources" }).click();
    await expect(page.getByText("Built by D Siva Kumar with help from the CodeBasics Team.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Salaried Individuals AY 2026-27" })).toHaveAttribute("href", /return-applicable-1/);
    await expect(page.getByRole("link", { name: "Business/Profession AY 2026-27" })).toHaveAttribute("href", /individual-business-profession/);

    await page.getByRole("button", { name: "Privacy" }).click();
    await expect(page.getByText("What is stored")).toBeVisible();
    await expect(page.getByText("localStorage on this device")).toBeVisible();
  });

  test("renders animated result amounts and keeps tax math on backend calls", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 1275000);

    const computeCalls = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/v1/tax/compute")) computeCalls.push(request.url());
    });

    await runCompute(page);

    await expect(page.getByTestId("animated-result-amount").first()).toBeVisible();
    expect(computeCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("respects reduced motion for new choice-card animation surfaces", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 820 });

    await page.goto("/");
    await expect(page.getByTestId("api-status")).toContainText("API connected");

    await expect(page.getByTestId("choice-card").first()).toBeVisible();
    const animationDuration = await page.getByTestId("choice-card").first().evaluate((node) => {
      return getComputedStyle(node).animationDuration;
    });
    expect(animationDuration).toMatch(/0\.01ms|0s|1e-05s/);
  });

  test("keeps calculator actions in a bottom bar without hiding form content", async ({ page }) => {
    await openCalculator(page);

    await expect(page.getByTestId("action-bar")).toBeVisible();
    await expect(page.getByTestId("action-command-row")).toBeVisible();
    await expect(page.getByTestId("action-group-navigation")).toBeVisible();
    await expect(page.getByTestId("action-group-calculate")).toBeVisible();
    await expect(page.getByTestId("action-group-draft")).toBeVisible();
    await expect(page.getByTestId("action-group-import")).toBeHidden();
    await expect(page.getByTestId("action-group-review")).toBeHidden();
    await expect(page.getByTestId("validate-button")).toBeHidden();
    await expect(page.getByTestId("save-button")).toBeHidden();

    const actionBarLayout = await page.getByTestId("action-bar").evaluate((node) => {
      return {
        position: getComputedStyle(node).position,
        checklistInside: Boolean(node.querySelector("#guided-checklist"))
      };
    });
    expect(actionBarLayout.position).toBe("fixed");
    expect(actionBarLayout.checklistInside).toBe(false);

    const bottomSpacing = await page.getByTestId("action-bar").evaluate((node) => {
      const actionRect = node.getBoundingClientRect();
      const bodyPaddingBottom = Number.parseFloat(getComputedStyle(document.body).paddingBottom);
      return {
        actionHeight: actionRect.height,
        bodyPaddingBottom
      };
    });
    expect(bottomSpacing.bodyPaddingBottom).toBeGreaterThanOrEqual(bottomSpacing.actionHeight + 16);

    await page.getByTestId("action-group-calculate").locator("summary").click();
    await expect(page.getByTestId("validate-button")).toBeVisible();
    await page.getByTestId("action-group-draft").locator("summary").click();
    await expect(page.getByTestId("save-button")).toBeVisible();

    await goToStep(page, "imports");
    await expect(page.getByTestId("action-bar")).toBeVisible();
    await expect(page.getByTestId("action-group-import")).toBeVisible();
    await expect(page.getByTestId("preview-import-button")).toBeHidden();
    await page.getByTestId("action-group-import").locator("summary").click();
    await expect(page.getByTestId("preview-import-button")).toBeVisible();

    await goToStep(page, "results");
    await expect(page.getByTestId("action-bar")).toBeVisible();
    await expect(page.getByTestId("action-group-review")).toBeVisible();
  });

  test("keeps action dropdowns mutually exclusive, dismissible, and closed after selection", async ({ page }) => {
    await openCalculator(page);

    await page.getByTestId("action-group-calculate").locator("summary").click();
    await expect(page.getByTestId("validate-button")).toBeVisible();

    await page.getByTestId("action-group-draft").locator("summary").click();
    await expect(page.getByTestId("save-button")).toBeVisible();
    await expect(page.getByTestId("validate-button")).toBeHidden();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("save-button")).toBeHidden();

    await clickAction(page, "validate-button");
    await expect(page.getByTestId("panel-results")).toBeVisible();
    await expect(page.getByTestId("validate-button")).toBeHidden();
  });

  test("keeps mobile action panels inside the viewport without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await openCalculator(page);

    await page.getByTestId("action-group-calculate").locator("summary").click();
    await expect(page.getByTestId("compute-button")).toBeVisible();

    const dropdownBounds = await page.getByTestId("action-group-calculate").locator(".action-menu-panel").evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        viewportWidth: window.innerWidth,
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    expect(dropdownBounds.left).toBeGreaterThanOrEqual(0);
    expect(dropdownBounds.right).toBeLessThanOrEqual(dropdownBounds.viewportWidth);
    expect(dropdownBounds.documentOverflow).toBeLessThanOrEqual(1);
  });
});
