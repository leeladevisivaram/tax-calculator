import { expect, test } from "@playwright/test";
import {
  clearScenarioField,
  clickAction,
  expectActionError,
  fillSalaryScenario,
  goToStep,
  openCalculator,
  runCompare,
  runCompute,
  setScenarioField
} from "./helpers.mjs";

test.describe("Feature: Beginner-friendly vNext", () => {
  test("selects a beginner persona, focuses the checklist, and updates step health", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("api-status")).toContainText("API connected");
    await expect(page.getByTestId("beginner-mode-tab")).toHaveCount(0);

    await page.getByTestId("choice-card").filter({ hasText: "Salaried" }).click();

    await expect(page.getByTestId("panel-income")).toBeVisible();
    await expect(page.getByTestId("guided-checklist")).toContainText("Salaried checklist");
    await expect(page.getByTestId("guided-checklist")).toContainText("Run Validate, Compute, Compare regimes, and Explain");
    await expect(page.locator('[name="income_head_salary"]')).toBeChecked();
    await expect(page.getByTestId("step-income").getByTestId("step-health")).toContainText("Complete");
    await expect(page.getByTestId("sticky-summary")).toContainText("Current step");
  });

  test("focuses the first missing required field for beginner recovery", async ({ page }) => {
    await openCalculator(page);
    await clearScenarioField(page, "age_years");

    await clickAction(page, "validate-button");

    await expectActionError(page, "Validate cannot run because Age is missing.");
    await expect(page.getByTestId("panel-profile")).toBeVisible();
    await expect(page.getByTestId("age-input")).toBeFocused();
  });

  test("renders result visuals and compares saved what-if scenarios through the API", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 1275000);

    let reviewCalls = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/v1/ai/review-scenario")) reviewCalls += 1;
    });

    await runCompute(page);
    await expect(page.getByTestId("tax-waterfall")).toContainText("Gross total income");
    await expect(page.getByTestId("result-explain-summary")).toContainText("Plain-English result");
    await expect(page.getByTestId("ai-review-center")).toContainText("AI Review Center");
    await expect(page.getByTestId("ai-review-score")).toContainText("Confidence");
    await expect(page.getByTestId("ai-finding").first()).toBeVisible();
    await expect(page.getByTestId("ai-next-action").first()).toBeVisible();
    expect(reviewCalls).toBeGreaterThanOrEqual(1);

    await runCompare(page);
    await expect(page.getByTestId("regime-savings-banner")).toContainText("regime is lower");

    await page.getByTestId("scenario-save").click();
    await expect(page.getByTestId("scenario-output")).toContainText("Saved");

    let computeCalls = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/v1/tax/compute")) computeCalls += 1;
    });

    await goToStep(page, "income");
    await setScenarioField(page, "gross_salary", 1500000);
    await page.getByTestId("scenario-compare").click();

    await expect(page.getByTestId("scenario-output")).toContainText("Difference");
    expect(computeCalls).toBeGreaterThanOrEqual(2);
  });

  test("keeps beginner layout usable on mobile and respects reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 820 });
    await page.goto("/");
    await expect(page.getByTestId("api-status")).toContainText("API connected");

    await expect(page.getByTestId("choice-card").first()).toBeVisible();
    await expect(page.getByTestId("beginner-mode-tab")).toHaveCount(0);
    await page.getByTestId("calculator-tab").click();
    await expect(page.getByTestId("step-profile")).toBeVisible();

    const animationDuration = await page.locator(".step-panel.active").evaluate((node) => {
      return getComputedStyle(node).animationDuration;
    });
    expect(animationDuration).toMatch(/0\.01ms|0s|1e-05s/);
  });
});
