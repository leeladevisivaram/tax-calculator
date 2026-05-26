import { expect, test } from "@playwright/test";
import {
  assertNoInternalLabels,
  clearScenarioField,
  clickAction,
  expectActionError,
  fillBaseProfile,
  fillSalaryScenario,
  getJson,
  goToStep,
  openCalculator,
  postJson,
  runCompare,
  runCompute,
  runExplain,
  runValidate,
  setIncomeHead,
  setScenarioField,
  withPayload
} from "./helpers.mjs";

const requiredScenarioFields = [
  ["period_type", "Period type"],
  ["period", "Period"],
  ["act", "Act"],
  ["taxpayer_type", "Taxpayer type"],
  ["residency", "Residency"],
  ["age_years", "Age"],
  ["regime", "Regime"]
];

const primaryActions = [
  ["validate-button", "Validate"],
  ["compute-button", "Compute"],
  ["compare-button", "Compare regimes"],
  ["explain-button", "Explain"]
];

test.describe("Feature: UI regression - primary action validation", () => {
  test.describe("Task: missing required fields for calculation actions", () => {
    for (const [buttonTestId, actionLabel] of primaryActions) {
      for (const [fieldName, fieldLabel] of requiredScenarioFields) {
        test(`${actionLabel} reports missing ${fieldLabel}`, async ({ page }) => {
          await openCalculator(page);
          await clearScenarioField(page, fieldName);

          await clickAction(page, buttonTestId);
          await expectActionError(page, `${actionLabel} cannot run because ${fieldLabel} is missing.`);
        });
      }
    }
  });
});

test.describe("Feature: UI regression - supported income computations", () => {
  test.describe("Task: salary, comparison, capital gains, and presumptive results", () => {
    test("computes TV-001 salary no-tax threshold and compares regimes", async ({ page, request }) => {
      await openCalculator(page);
      await fillSalaryScenario(page, 1275000);

      await runCompute(page);
      await expect(page.getByTestId("result-output")).toContainText("₹0");
      await expect(page.getByTestId("result-output")).toContainText("₹12,00,000");

      await runCompare(page);
      await expect(page.getByTestId("new-regime-card")).toContainText("₹0");

      const apiResult = await postJson(request, "/api/v1/tax/compute", withPayload({
        income: { salary: { gross_salary: 1275000 } },
        deductions: { standard_deduction: true }
      }));
      expect(apiResult.summary.total_income).toBe(1200000);
      expect(apiResult.summary.net_tax_liability).toBe(0);
    });

    test("computes 112A special-rate capital gains and verifies rebate limitation", async ({ page, request }) => {
      await openCalculator(page);
      await fillSalaryScenario(page, 1275000);
      await setIncomeHead(page, "capital_gains", true);
      await setScenarioField(page, "capital_gain_section", "112A");
      await setScenarioField(page, "capital_gain_transfer_date", "2025-08-15");
      await setScenarioField(page, "capital_gain_net_gain", 300000);

      await runValidate(page);
      await expect(page.getByTestId("validation-output")).toContainText("WARN_REBATE_SPECIAL_RATE_LIMIT");
      await runCompute(page);
      await expect(page.getByTestId("result-output")).toContainText("₹21,875");
      await expect(page.getByTestId("result-output")).toContainText("₹22,750");

      const apiResult = await postJson(request, "/api/v1/tax/compute", withPayload({
        income: {
          salary: { gross_salary: 1275000 },
          capital_gains: [{ section: "112A", transfer_date: "2025-08-15", net_gain: 300000, stt_paid: true }]
        },
        deductions: { standard_deduction: true }
      }));
      expect(apiResult.summary.special_rate_tax["112A"].tax_before_cess).toBe(21875);
      expect(apiResult.summary.net_tax_liability).toBe(22750);
    });

    test("computes 44AD presumptive business income through UI and API", async ({ page, request }) => {
      await openCalculator(page);
      await goToStep(page, "income");
      await setIncomeHead(page, "salary", false);
      await setIncomeHead(page, "business", true);
      await setScenarioField(page, "business_section", "44AD");
      await setScenarioField(page, "business_receipts", 25000000);
      await setScenarioField(page, "business_cash_receipts", 1000000);
      await setScenarioField(page, "business_digital_receipts", 24000000);

      await runCompute(page);
      await expect(page.getByTestId("result-output")).toContainText("₹15,20,000");

      const apiResult = await postJson(request, "/api/v1/tax/compute", withPayload({
        income: {
          business_profession: [{ section: "44AD", turnover: 25000000, cash_receipts: 1000000, digital_receipts: 24000000 }]
        },
        deductions: { standard_deduction: true }
      }));
      expect(apiResult.summary.business_profession["44AD"].deemed_income).toBe(1520000);
    });

    test("computes 44ADA presumptive profession income through UI and API", async ({ page, request }) => {
      await openCalculator(page);
      await goToStep(page, "income");
      await setIncomeHead(page, "salary", false);
      await setIncomeHead(page, "business", true);
      await setScenarioField(page, "business_section", "44ADA");
      await setScenarioField(page, "business_receipts", 7000000);
      await setScenarioField(page, "business_cash_receipts", 100000);

      await runCompute(page);
      await expect(page.getByTestId("result-output")).toContainText("₹35,00,000");

      const apiResult = await postJson(request, "/api/v1/tax/compute", withPayload({
        income: {
          business_profession: [{ section: "44ADA", gross_receipts: 7000000, cash_receipts: 100000 }]
        },
        deductions: { standard_deduction: true }
      }));
      expect(apiResult.summary.business_profession["44ADA"].deemed_income).toBe(3500000);
    });
  });
});

test.describe("Feature: UI regression - provision validation", () => {
  test.describe("Task: deductions, HRA, LTA, and house-property guardrails", () => {
    test("shows new-regime deduction and 80EE/80EEA validation messages", async ({ page }) => {
      await openCalculator(page);
      await goToStep(page, "deductions");
      await setScenarioField(page, "deduction_80c", 150000);
      await setScenarioField(page, "deduction_80ee", 50000);
      await setScenarioField(page, "deduction_80eea", 150000);

      await runValidate(page);
      await expect(page.getByTestId("validation-output")).toContainText("WARN_CHAPTER_VIA_DEDUCTIONS_IGNORED_NEW_REGIME");
      await expect(page.getByTestId("validation-output")).toContainText("WARN_80EE_80EEA_MUTUAL_EXCLUSION");
    });

    test("blocks old-regime HRA when base salary is missing", async ({ page }) => {
      await openCalculator(page);
      await fillBaseProfile(page, { regime: "old" });
      await goToStep(page, "income");
      await setScenarioField(page, "gross_salary", 700000);
      await setScenarioField(page, "basic_salary", 0);
      await setScenarioField(page, "hra_received", 120000);
      await setScenarioField(page, "rent_paid", 180000);

      await runValidate(page);
      await expect(page.getByTestId("validation-output")).toContainText("VAL_HRA_SALARY_BASE_REQUIRED");
    });

    test("blocks LTA when journey count is exhausted", async ({ page }) => {
      await openCalculator(page);
      await fillBaseProfile(page, { regime: "old" });
      await goToStep(page, "income");
      await setScenarioField(page, "gross_salary", 500000);
      await setScenarioField(page, "lta_claim", 50000);
      await setScenarioField(page, "lta_journeys", 2);

      await runValidate(page);
      await expect(page.getByTestId("validation-output")).toContainText("WARN_LTA_BLOCK_LIMIT_EXCEEDED");
    });

    test("runs house-property interest and loss path without duplicating formulas in UI", async ({ page, request }) => {
      await openCalculator(page);
      await fillBaseProfile(page, { regime: "old" });
      await goToStep(page, "income");
      await setIncomeHead(page, "salary", false);
      await setIncomeHead(page, "house", true);
      await setScenarioField(page, "self_occupied_interest", 280000);
      await setScenarioField(page, "let_out_loss", 300000);

      await runValidate(page);
      await runCompute(page);
      await expect(page.getByTestId("result-output")).toContainText("Payable / refund");

      const apiResult = await postJson(request, "/api/v1/tax/compute", withPayload({
        regime: "old",
        income: {
          house_property: [
            { property_type: "self_occupied", loan_purpose: "purchase", interest_paid: 280000 },
            { property_type: "let_out", computed_loss: 300000 }
          ]
        },
        deductions: { standard_deduction: true }
      }));
      expect(apiResult.summary.house_property_loss_setoff_against_other_heads).toBeLessThanOrEqual(200000);
    });
  });
});

test.describe("Feature: UI regression - import, report, privacy, ops, and launch", () => {
  test.describe("Task: import-to-compute and downloadable reports", () => {
    test("maps confirmed import values, computes, explains, and downloads reports", async ({ page }) => {
      await openCalculator(page);
      await goToStep(page, "imports");

      await page.getByTestId("import-content").fill("gross_salary,tds,deduction_80c,employer_name\n900000,45000,150000,Example Employer");
      await clickAction(page, "preview-import-button");
      await expect(page.getByTestId("import-output")).toContainText("Import preview");
      await page.getByTestId("import-confirmed").check();
      await clickAction(page, "apply-import-button");
      await expect(page.getByTestId("draft-status")).toContainText("Import applied after confirmation");
      await expect(page.getByTestId("gross-salary")).toHaveValue("900000");

      await runCompute(page);
      await expect(page.getByTestId("result-output")).toContainText("₹9,00,000");
      await runExplain(page);

      const download = page.waitForEvent("download");
      await clickAction(page, "download-json-button");
      expect((await download).suggestedFilename()).toMatch(/tax-report.*\.json$/);
    });
  });

  test.describe("Task: privacy, operations, and launch readiness", () => {
    test("exports and deletes local browser data through UI controls", async ({ page }) => {
      await openCalculator(page);
      await fillSalaryScenario(page, 900000);
      await clickAction(page, "save-button");
      await expect(page.getByTestId("draft-status")).toContainText("Draft saved");

      await goToStep(page, "profile");
      const download = page.waitForEvent("download");
      await page.getByTestId("export-local-data-button").click();
      expect((await download).suggestedFilename()).toBe("tax-calculator-privacy-export.json");
      await expect(page.getByTestId("privacy-output")).toContainText("Export ready");

      await page.getByTestId("delete-local-data-button").click();
      await expect(page.getByTestId("privacy-output")).toContainText("Local data deleted");
      await expect(page.getByTestId("draft-status")).toContainText("Local data deleted");
    });

    test("runs launch regression, support SOP, readiness, and triage through browser actions", async ({ page, request }) => {
      await openCalculator(page);
      await goToStep(page, "launch");

      await page.getByTestId("beta-plan-button").click();
      await expect(page.getByTestId("launch-output")).toContainText("Closed beta plan");

      await page.getByTestId("run-regression-button").click();
      await expect(page.getByTestId("launch-output")).toContainText("Final regression");
      await expect(page.getByTestId("launch-output")).toContainText("30/30");

      await page.getByTestId("support-sop-button").click();
      await expect(page.getByTestId("launch-output")).toContainText("Support SOP");

      await page.getByTestId("readiness-button").click();
      await expect(page.getByTestId("launch-output")).toContainText("Launch readiness");

      await page.getByTestId("feedback-description").fill("Wrong tax amount for 112A after date split.");
      await page.getByTestId("classify-feedback-button").click();
      await expect(page.getByTestId("launch-output")).toContainText("Launch blocker");
      await assertNoInternalLabels(page);

      const metrics = await getJson(request, "/api/v1/ops/metrics");
      expect(metrics.status).toBe("ok");
      const readiness = await getJson(request, "/api/v1/launch/readiness");
      expect(readiness.machine_gate_status).toBe("pass");
    });
  });
});

test.describe("Feature: UI regression - backend-only sprint artifacts", () => {
  test.describe("Task: rule schema, source register, templates, and endpoint evidence", () => {
    test("verifies non-visual sprint artifacts through Playwright API requests", async ({ request }) => {
      const periods = await getJson(request, "/api/v1/rules/periods");
      expect(periods.periods.map((period) => period.rulepack_id)).toEqual(["ay-2025-26-v1", "ay-2026-27-v1"]);

      const source = await getJson(request, "/api/v1/sources/SRC-ITD-SALARIED-AY2026");
      expect(source.source.source_id).toBe("SRC-ITD-SALARIED-AY2026");

      const templates = await getJson(request, "/api/v1/imports/templates");
      expect(templates.templates.some((template) => template.import_type === "form16")).toBeTruthy();

      const regression = await getJson(request, "/api/v1/launch/regression");
      expect(regression.golden_vectors.failed).toBe(0);
      expect(regression.machine_gate_status).toBe("pass");
    });
  });
});
