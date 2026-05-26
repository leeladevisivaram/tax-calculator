import { expect, test } from "@playwright/test";
import {
  assertNoInternalLabels,
  clickAction,
  fillBaseProfile,
  fillSalaryScenario,
  goToStep,
  openCalculator,
  runCompare,
  runCompute,
  runValidate,
  setIncomeHead,
  setScenarioField
} from "./helpers.mjs";

test.describe("Sprint 4 UAT: Application Shell and Navigation", () => {
  test("TC-S4-001 app shell loads header, steps, and profile section", async ({ page }) => {
    await openCalculator(page);
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByTestId("wizard-stepper")).toBeVisible();
    await expect(page.getByTestId("panel-profile")).toBeVisible();
    await assertNoInternalLabels(page);
  });

  test("TC-S4-002 year selector retains supported assessment year", async ({ page }) => {
    await openCalculator(page);
    await page.getByTestId("period-select").selectOption("2025-26");
    await expect(page.getByTestId("period-select")).toHaveValue("2025-26");
    await expect(page.getByTestId("sticky-summary")).toContainText("AY 2025-26");
  });

  test("TC-S4-003 taxpayer type selector shows Individual and HUF and retains HUF", async ({ page }) => {
    await openCalculator(page);
    await expect(page.getByTestId("taxpayer-type")).toContainText("Individual");
    await expect(page.getByTestId("taxpayer-type")).toContainText("HUF");
    await page.getByTestId("taxpayer-type").selectOption("huf");
    await goToStep(page, "income");
    await goToStep(page, "profile");
    await expect(page.getByTestId("taxpayer-type")).toHaveValue("huf");
  });

  test("TC-S4-004 step navigation preserves entered income values", async ({ page }) => {
    await openCalculator(page);
    await goToStep(page, "income");
    await page.getByTestId("gross-salary").fill("1275000");
    await goToStep(page, "deductions");
    await expect(page.getByTestId("panel-deductions")).toBeVisible();
    await goToStep(page, "income");
    await expect(page.getByTestId("gross-salary")).toHaveValue("1275000");
  });

  test("TC-S4-005 back navigation keeps existing form data", async ({ page }) => {
    await openCalculator(page);
    await page.getByTestId("next-step").click();
    await page.getByTestId("next-step").click();
    await expect(page.getByTestId("panel-income")).toBeVisible();
    await page.getByTestId("gross-salary").fill("900000");
    await page.getByTestId("prev-step").click();
    await page.getByTestId("next-step").click();
    await expect(page.getByTestId("gross-salary")).toHaveValue("900000");
  });

  test("TC-S4-006 Indian currency formatting uses rupee and lakh/crore-friendly grouping", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 1275000);
    await expect(page.getByTestId("sticky-summary")).toContainText("INR 12.75L");
    await runCompute(page);
    await expect(page.getByTestId("result-output")).toContainText("₹12,75,000");
  });

  test("TC-S4-007 desktop layout has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await openCalculator(page);
    await expectNoHorizontalOverflow(page);
  });

  test("TC-S4-008 mobile layout has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCalculator(page);
    await expectNoHorizontalOverflow(page);
    await expect(page.getByTestId("sticky-summary")).toBeVisible();
  });

  test("TC-S4-009 keyboard navigation reaches primary controls with visible focus", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("hero-start-button")).toBeVisible();
    await page.getByTestId("hero-start-button").focus();
    await expect(page.getByTestId("hero-start-button")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tax-wizard")).toBeVisible();
    await goToStep(page, "results");
    await page.getByTestId("action-group-calculate").locator("summary").click();
    await page.getByTestId("validate-button").focus();
    await expect(page.getByTestId("validate-button")).toBeFocused();
  });

  test("TC-S4-010 skip link moves focus to calculator", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.locator(".skip-link")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tax-wizard")).toBeFocused();
  });

  test("TC-S4-011 language selector falls back without broken labels", async ({ page }) => {
    await openCalculator(page);
    await page.getByTestId("language-select").selectOption("hi-IN");
    await expect(page.locator("html")).toHaveAttribute("lang", "hi-IN");
    await expect(page.getByTestId("draft-status")).toContainText("English fallback");
    await assertNoBrokenVisibleText(page);
  });
});

test.describe("Sprint 4 UAT: Income Entry Screens", () => {
  test("TC-S4-012 salary entry updates income summary", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 1275000);
    await expect(page.getByTestId("gross-salary")).toHaveValue("1275000");
    await expect(page.getByTestId("sticky-summary")).toContainText("INR 12.75L");
  });

  test("TC-S4-013 allowance entry groups HRA and LTA fields correctly", async ({ page }) => {
    await openCalculator(page);
    await fillBaseProfile(page, { regime: "old" });
    await goToStep(page, "income");
    await setScenarioField(page, "basic_salary", 600000);
    await setScenarioField(page, "hra_received", 180000);
    await setScenarioField(page, "rent_paid", 240000);
    await setScenarioField(page, "lta_received", 50000);
    await setScenarioField(page, "lta_claim", 40000);
    await expect(page.locator("[name='hra_received']")).toHaveValue("180000");
    await expect(page.locator("[name='lta_claim']")).toHaveValue("40000");
  });

  test("TC-S4-014 HRA in new regime displays regime awareness warning", async ({ page }) => {
    await openCalculator(page);
    await goToStep(page, "income");
    await setScenarioField(page, "basic_salary", 600000);
    await setScenarioField(page, "hra_received", 180000);
    await setScenarioField(page, "rent_paid", 240000);
    await runValidate(page);
    await expect(page.getByTestId("validation-output")).toContainText("WARN_HRA_NOT_AVAILABLE_NEW_REGIME");
  });

  test("TC-S4-015 house property self-occupied interest is accepted and computes safely", async ({ page }) => {
    await openCalculator(page);
    await fillBaseProfile(page, { regime: "old" });
    await goToStep(page, "income");
    await setIncomeHead(page, "house", true);
    await setScenarioField(page, "self_occupied_interest", 200000);
    await expect(page.locator("[name='self_occupied_interest']")).toHaveValue("200000");
    await runCompute(page);
    await expect(page.getByTestId("result-output")).toContainText("Payable / refund");
  });

  test("TC-S4-016 capital-gains add row enables and saves row values", async ({ page }) => {
    await openCalculator(page);
    await goToStep(page, "income");
    await setIncomeHead(page, "capital_gains", true);
    await page.getByTestId("add-capital-gain-button").click();
    await expect(page.getByTestId("capital-gain-row-status")).toContainText("row added");
    await setScenarioField(page, "capital_gain_section", "112A");
    await setScenarioField(page, "capital_gain_net_gain", 300000);
    await expect(page.locator("[name='capital_gain_section']")).toHaveValue("112A");
    await expect(page.locator("[name='capital_gain_net_gain']")).toHaveValue("300000");
  });

  test("TC-S4-017 capital-gains delete row clears row values", async ({ page }) => {
    await openCalculator(page);
    await goToStep(page, "income");
    await setIncomeHead(page, "capital_gains", true);
    await page.getByTestId("add-capital-gain-button").click();
    await setScenarioField(page, "capital_gain_net_gain", 300000);
    await page.getByTestId("delete-capital-gain-button").click();
    await expect(page.getByTestId("capital-gain-row-status")).toContainText("row removed");
    await expect(page.locator("[name='capital_gain_section']")).toHaveValue("");
    await expect(page.locator("[name='capital_gain_net_gain']")).toHaveValue("0");
  });

  test("TC-S4-018 business panel shows presumptive fields and hides normal-only fields", async ({ page }) => {
    await openCalculator(page);
    await goToStep(page, "income");
    await setIncomeHead(page, "business", true);
    await setScenarioField(page, "business_section", "44AD");
    await expect(page.getByTestId("business-mode-hint")).toContainText("44AD");
    await expect(page.locator("[data-business-field='normal']")).toBeHidden();
    await expect(page.locator("[data-business-field='presumptive']").first()).toBeVisible();
    await expect(page.locator("[data-business-field='44AD']")).toBeVisible();
  });

  test("TC-S4-019 other sources entry contributes to computed income", async ({ page }) => {
    await openCalculator(page);
    await goToStep(page, "income");
    await setIncomeHead(page, "other_sources", true);
    await setScenarioField(page, "interest_income", 20000);
    await runCompute(page);
    await expect(page.getByTestId("result-output")).toContainText("₹12,95,000");
  });

  test("TC-S4-020 invalid negative amount is blocked by field-level validation", async ({ page }) => {
    await openCalculator(page);
    await goToStep(page, "income");
    await page.getByTestId("gross-salary").fill("-1000");
    await clickAction(page, "validate-button");
    await expect(page.getByTestId("action-error")).toContainText("Gross salary must be zero or more");
    await expect(page.getByTestId("gross-salary")).toHaveAttribute("aria-invalid", "true");
  });

  test("TC-S4-021 very large income computes without crashing the UI", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 1000000000);
    await runCompute(page);
    await expect(page.getByTestId("result-output")).toContainText("Payable / refund");
    await expect(page.getByTestId("result-output")).not.toContainText("NaN");
  });
});

test.describe("Sprint 4 UAT: Deduction and Credit Screens", () => {
  test("TC-S4-022 deduction groups are visible and clearly organized", async ({ page }) => {
    await openCalculator(page);
    await goToStep(page, "deductions");
    await expect(page.locator("[name='deduction_80c']")).toBeVisible();
    await expect(page.locator("[name='deduction_80d_self_premium']")).toBeVisible();
    await expect(page.locator("[name='deduction_80gg_rent']")).toBeVisible();
    await expect(page.locator("[name='deduction_80ee']")).toBeVisible();
  });

  test("TC-S4-023 new regime with 80C shows ignored-deduction warning", async ({ page }) => {
    await openCalculator(page);
    await goToStep(page, "deductions");
    await setScenarioField(page, "deduction_80c", 150000);
    await runValidate(page);
    await expect(page.getByTestId("validation-output")).toContainText("WARN_CHAPTER_VIA_DEDUCTIONS_IGNORED_NEW_REGIME");
  });

  test("TC-S4-024 80D self and parent buckets remain separate", async ({ page }) => {
    await openCalculator(page);
    await fillBaseProfile(page, { regime: "old" });
    await goToStep(page, "deductions");
    await setScenarioField(page, "deduction_80d_self_premium", 24000);
    await setScenarioField(page, "deduction_80d_self_preventive", 2000);
    await setScenarioField(page, "deduction_80d_parent_premium", 48000);
    await setScenarioField(page, "deduction_80d_parent_preventive", 3000);
    await page.locator("[name='deduction_80d_parent_senior']").check();
    await runValidate(page);
    await expect(page.getByTestId("validation-output")).toContainText("WARN_80D_PREVENTIVE_INCLUDED_IN_BUCKET_CAP");
  });

  test("TC-S4-025 credit entry is reflected in result credits and refund position", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 1400000);
    await goToStep(page, "credits");
    await page.getByTestId("tds-input").fill("100000");
    await runCompute(page);
    await expect(page.getByTestId("result-output")).toContainText("Credits");
    await expect(page.getByTestId("result-output")).toContainText("₹1,00,000");
    await expect(page.getByTestId("result-output")).toContainText("-₹18,100");
  });

  test("TC-S4-026 over-limit 80C displays inline validation warning", async ({ page }) => {
    await openCalculator(page);
    await fillBaseProfile(page, { regime: "old" });
    await goToStep(page, "deductions");
    await setScenarioField(page, "deduction_80c", 220000);
    await runValidate(page);
    await expect(page.getByTestId("validation-output")).toContainText("WARN_80C_CAP_APPLIED");
  });

  test("TC-S4-027 save draft stores local state", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 900000);
    await clickAction(page, "save-button");
    await expect(page.getByTestId("draft-status")).toContainText("Draft saved");
    const storedDraft = await page.evaluate(() => localStorage.getItem("tax-wizard-draft"));
    expect(storedDraft).toContain("900000");
  });

  test("TC-S4-028 restore draft after reload keeps saved values", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 900000);
    await clickAction(page, "save-button");
    await page.reload();
    await expect(page.getByTestId("draft-status")).toContainText("Draft restored");
    await expect(page.getByTestId("gross-salary")).toHaveValue("900000");
  });

  test("TC-S4-029 reset scenario clears saved draft after confirmation", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 900000);
    await clickAction(page, "save-button");
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Reset this scenario");
      await dialog.accept();
    });
    await clickAction(page, "reset-button");
    await expect(page.getByTestId("draft-status")).toContainText("Draft reset");
    await expect(page.getByTestId("gross-salary")).toHaveValue("1275000");
    const storedDraft = await page.evaluate(() => localStorage.getItem("tax-wizard-draft"));
    expect(storedDraft).toBeNull();
  });

  test("TC-S4-030 unavailable browser storage shows graceful warning", async ({ page }) => {
    await page.addInitScript(() => {
      for (const method of ["getItem", "setItem", "removeItem"]) {
        Storage.prototype[method] = function throwStorageUnavailable() {
          throw new Error("storage unavailable");
        };
      }
    });
    await page.goto("/");
    await page.getByTestId("calculator-tab").click();
    await expect(page.getByTestId("tax-wizard")).toBeVisible();
    await clickAction(page, "save-button");
    await expect(page.getByTestId("draft-status")).toContainText("Draft storage unavailable");
  });
});

test.describe("Sprint 4 UAT: Results and Regime Comparison", () => {
  test("TC-S4-031 compute result display shows payable/refund headline and correct zero tax", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 1275000);
    await runCompute(page);
    await expect(page.getByTestId("result-output")).toContainText("Payable / refund");
    await expect(page.getByTestId("result-output")).toContainText("₹0");
  });

  test("TC-S4-032 old-vs-new comparison shows both regimes and highlights lower regime", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 1400000);
    await runCompare(page);
    await expect(page.getByTestId("old-regime-card")).toBeVisible();
    await expect(page.getByTestId("new-regime-card")).toBeVisible();
    await expect(page.locator("[data-testid$='-regime-card'].recommended")).toHaveCount(1);
  });

  test("TC-S4-033 waterfall result cards appear in expected order", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 1275000);
    await runCompute(page);
    const labels = await page.getByTestId("result-metric").locator("span").allTextContents();
    expect(labels.slice(0, 4)).toEqual([
      "Payable / refund",
      "Gross total income",
      "Deductions",
      "Total income"
    ]);
  });

  test("TC-S4-034 salary-only scenario recommends ITR-1", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 900000);
    await runCompute(page);
    await expect(page.getByTestId("result-output")).toContainText("Likely ITR form");
    await expect(page.getByTestId("result-output")).toContainText("ITR-1");
  });

  test("TC-S4-035 unsupported complexity shows filing-readiness warning", async ({ page }) => {
    await openCalculator(page);
    await page.getByTestId("taxpayer-type").evaluate((select) => {
      const option = document.createElement("option");
      option.value = "company";
      option.textContent = "Company";
      select.append(option);
      select.value = "company";
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await runValidate(page);
    await expect(page.getByTestId("validation-output")).toContainText("VAL_TAXPAYER_TYPE_UNSUPPORTED");
  });

  test("TC-S4-036 refund display shows excess credits clearly", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 1400000);
    await goToStep(page, "credits");
    await page.getByTestId("tds-input").fill("100000");
    await runCompute(page);
    await expect(page.getByTestId("result-output")).toContainText("-₹18,100");
    await expect(page.getByTestId("sticky-summary")).toContainText("-₹18,100");
  });

  test("TC-S4-037 payable display shows positive amount when credits are lower than liability", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 1400000);
    await runCompute(page);
    await expect(page.getByTestId("result-output")).toContainText("₹81,900");
    await expect(page.getByTestId("sticky-summary")).toContainText("₹81,900");
  });

  test("TC-S4-038 compute API failure renders recoverable user error", async ({ page }) => {
    await page.route("**/api/v1/tax/compute", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ status: "error", error: "Temporary compute outage" })
      });
    });
    await openCalculator(page);
    await fillSalaryScenario(page, 1275000);
    await clickAction(page, "compute-button");
    await expect(page.getByTestId("action-error")).toContainText("Temporary compute outage");
  });

  test("TC-S4-039 regression completes salary, capital-gain, and presumptive UI flows", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 1275000);
    await runCompute(page);
    await expect(page.getByTestId("result-output")).toContainText("₹0");

    await goToStep(page, "income");
    await setIncomeHead(page, "capital_gains", true);
    await setScenarioField(page, "capital_gain_section", "112A");
    await setScenarioField(page, "capital_gain_transfer_date", "2025-08-15");
    await setScenarioField(page, "capital_gain_net_gain", 300000);
    await runCompute(page);
    await expect(page.getByTestId("result-output")).toContainText("₹22,750");

    await goToStep(page, "income");
    await setIncomeHead(page, "salary", false);
    await setIncomeHead(page, "capital_gains", false);
    await setIncomeHead(page, "business", true);
    await setScenarioField(page, "business_section", "44AD");
    await setScenarioField(page, "business_receipts", 25000000);
    await setScenarioField(page, "business_cash_receipts", 1000000);
    await setScenarioField(page, "business_digital_receipts", 24000000);
    await runCompute(page);
    await expect(page.getByTestId("result-output")).toContainText("₹15,20,000");
  });
});

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function assertNoBrokenVisibleText(page) {
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toMatch(/undefined|null|\[object Object\]/i);
}
