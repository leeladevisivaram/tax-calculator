import { expect, test } from "@playwright/test";
import {
  assertNoInternalLabels,
  clearScenarioField,
  clickAction,
  expectActionError,
  fillSalaryScenario,
  goToStep,
  openCalculator,
  runCompare,
  runCompute,
  runExplain,
  runValidate
} from "./helpers.mjs";

test.describe("Feature: UI BVT - calculator shell", () => {
  test.describe("Task: launch-critical smoke and accessibility", () => {
    test("loads the app, exposes required landmarks, and keeps labels user-safe", async ({ page }) => {
      await openCalculator(page);

      await expect(page.getByRole("banner")).toBeVisible();
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.getByRole("navigation", { name: /calculator sections/i })).toBeVisible();
      await expect(page.getByRole("heading", { name: /build your tax scenario/i })).toBeVisible();
      await expect(page.getByTestId("guide-tab")).toBeVisible();
      await expect(page.getByTestId("action-group-draft")).toBeVisible();
      await expect(page.getByTestId("chatbot-toggle-button")).toBeVisible();
      await expect(page.getByTestId("side-rail")).toBeVisible();
      await expect(page.getByTestId("usage-guide")).toBeHidden();

      await page.getByTestId("guide-tab").click();
      await expect(page.getByTestId("usage-guide")).toBeVisible();
      await expect(page.getByTestId("guide-components")).toContainText("Stepper");
      await expect(page.getByTestId("guide-user-levels")).toContainText("No tax knowledge");
      await expect(page.getByTestId("guide-user-levels")).toContainText("Advanced");
      await expect(page.getByTestId("guide-profile")).toContainText("Period type");
      await expect(page.getByTestId("guide-imports")).toContainText("Import review confirmation");
      await expect(page.getByTestId("guide-results")).toContainText("Generated explanation report");
      await expect(page.getByTestId("guide-error-messages")).toContainText("Age");
      await expect(page.getByTestId("guide-error-messages")).toContainText("Feedback is missing");
      await page.getByTestId("calculator-tab").click();
      await expect(page.getByTestId("usage-guide")).toBeHidden();

      await expect(page.getByTestId("sticky-summary")).toContainText("Calculation confidence: high");

      const controlsWithoutLabels = await page.locator("input, select, textarea").evaluateAll((controls) => {
        return controls
          .filter((control) => {
            const id = control.getAttribute("id");
            const hasParentLabel = Boolean(control.closest("label"));
            const hasAria = Boolean(control.getAttribute("aria-label") || control.getAttribute("aria-labelledby"));
            const hasForLabel = id ? Boolean(document.querySelector(`label[for="${id}"]`)) : false;
            return !hasParentLabel && !hasAria && !hasForLabel;
          })
          .map((control) => control.getAttribute("name") || control.outerHTML);
      });
      expect(controlsWithoutLabels).toEqual([]);
    });

    test("opens chatbot, answers app questions, fills fields, and refuses out-of-scope prompts", async ({ page }) => {
      await openCalculator(page);

      await page.getByTestId("chatbot-toggle-button").click();
      await expect(page.getByTestId("chatbot-panel")).toBeVisible();
      await expect(page.getByTestId("chatbot-ai-status")).toContainText("AI assist is matching app help content");

      await page.getByTestId("chatbot-input").fill("Where do I enter TDS?");
      await page.getByTestId("chatbot-send-button").click();
      await expect(page.getByTestId("chatbot-messages")).toContainText("Credits");
      await expect(page.getByTestId("panel-credits")).toBeVisible();
      await expect(page.getByTestId("chatbot-ai-status")).toContainText(/AI assist/);

      await page.getByTestId("chatbot-input").fill("I do not know tax where should I start?");
      await page.getByTestId("chatbot-send-button").click();
      await expect(page.getByTestId("chatbot-messages")).toContainText("Start with Profile");
      await expect(page.getByTestId("panel-profile")).toBeVisible();

      await page.getByTestId("chatbot-input").fill("Can I upload a PDF Form 16?");
      await page.getByTestId("chatbot-send-button").click();
      await expect(page.getByTestId("chatbot-messages")).toContainText("PDF upload is active");
      await expect(page.getByTestId("panel-imports")).toBeVisible();

      await page.getByTestId("chatbot-input").fill("Set gross salary to 900000");
      await page.getByTestId("chatbot-send-button").click();
      await expect(page.getByTestId("gross-salary")).toHaveValue("900000");
      await expect(page.getByTestId("panel-income")).toBeVisible();

      await page.getByTestId("chatbot-input").fill("Choose old regime and set gross salary to 800000");
      await page.getByTestId("chatbot-send-button").click();
      await expect(page.getByTestId("chatbot-action-preview")).toContainText("Review suggested changes");
      await page.getByTestId("chatbot-apply-actions-button").click();
      await expect(page.locator('[name="regime"][value="old"]')).toBeChecked();
      await expect(page.getByTestId("gross-salary")).toHaveValue("800000");

      await page.getByTestId("chatbot-input").fill("Which mutual fund should I buy?");
      await page.getByTestId("chatbot-send-button").click();
      await expect(page.getByTestId("chatbot-messages")).toContainText("I can’t answer questions outside the app");
      await assertNoInternalLabels(page);
    });

    test("supports wizard navigation with keyboard-focusable primary actions", async ({ page }) => {
      await openCalculator(page);

      await page.getByTestId("next-step").click();
      await expect(page.getByTestId("panel-imports")).toBeVisible();
      await page.getByTestId("prev-step").click();
      await expect(page.getByTestId("panel-profile")).toBeVisible();
      await goToStep(page, "income");
      await goToStep(page, "deductions");
      await goToStep(page, "credits");
      await goToStep(page, "results");

      await clickAction(page, "application-guide-side-button");
      await expect(page.getByTestId("usage-guide")).toBeVisible();
      await page.getByTestId("calculator-tab").click();

      await page.getByTestId("action-group-calculate").locator("summary").click();
      await page.getByTestId("validate-button").focus();
      await expect(page.getByTestId("validate-button")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByTestId("compute-button")).toBeFocused();
    });
  });
});

test.describe("Feature: UI BVT - validation and calculation actions", () => {
  test.describe("Task: missing field validation and salary happy path", () => {
    test("shows exact missing-field validation for an empty required profile field", async ({ page }) => {
      await openCalculator(page);
      await clearScenarioField(page, "age_years");
      await clickAction(page, "validate-button");

      await expectActionError(page, "Validate cannot run because Age is missing.");
    });

    test("validates, computes, compares, explains, and downloads report artifacts", async ({ page }) => {
      await openCalculator(page);
      await fillSalaryScenario(page, 1275000);

      await runValidate(page);
      await expect(page.getByTestId("validation-output")).toContainText("INFO_NEW_REGIME_DEFAULT");

      await runCompute(page);
      await expect(page.getByTestId("result-output")).toContainText("₹0");
      await expect(page.getByTestId("sticky-summary")).toContainText("Likely");

      await runCompare(page);
      await expect(page.getByTestId("comparison-delta-card")).toContainText("Difference");

      await runExplain(page);
      await expect(page.getByTestId("report-meta-computation-hash")).toHaveCSS("overflow-wrap", "anywhere");
      await expect(page.getByTestId("report-meta-source-register")).toHaveCSS("overflow-wrap", "anywhere");
      const jsonDownload = page.waitForEvent("download");
      await clickAction(page, "download-json-button");
      expect((await jsonDownload).suggestedFilename()).toMatch(/\.json$/);

      const htmlDownload = page.waitForEvent("download");
      await clickAction(page, "download-html-button");
      expect((await htmlDownload).suggestedFilename()).toMatch(/\.html$/);
    });
  });

  test.describe("Task: import, privacy, and readiness surfaces", () => {
    test("rejects empty import submissions and applies reviewed import values", async ({ page }) => {
      await openCalculator(page);
      await goToStep(page, "imports");

      await page.getByTestId("import-content").fill("");
      await clickAction(page, "preview-import-button");
      await expectActionError(page, "Preview import cannot run because CSV, JSON, or extracted PDF content is missing.");

      await page.getByTestId("import-content").fill("gross_salary,tds,deduction_80c,employer_name\n900000,45000,150000,Example Employer");
      await clickAction(page, "apply-import-button");
      await expectActionError(page, "Apply import cannot run because Import review confirmation is missing.");

      await clickAction(page, "preview-import-button");
      await expect(page.getByTestId("import-review-item").first()).toContainText("gross_salary");
      await page.getByTestId("import-confirmed").check();
      await clickAction(page, "apply-import-button");
      await expect(page.getByTestId("draft-status")).toContainText("Import applied after confirmation");
      await expect(page.getByTestId("gross-salary")).toHaveValue("900000");
    });

    test("renders privacy and readiness messages without internal labels", async ({ page }) => {
      await openCalculator(page);

      await page.getByTestId("privacy-policy-button").click();
      await expect(page.getByTestId("privacy-output")).toContainText("Privacy policy");

      await goToStep(page, "launch");
      await page.getByTestId("readiness-button").click();
      await expect(page.getByTestId("launch-output")).toContainText("Launch readiness");
      await assertNoInternalLabels(page);
    });
  });
});
