import { expect, test } from "@playwright/test";
import {
  clearScenarioField,
  clickAction,
  expectActionError,
  fillBaseProfile,
  fillSalaryScenario,
  goToStep,
  openCalculator,
  postJson,
  runCompute,
  runValidate,
  setIncomeHead,
  setScenarioField,
  withPayload
} from "./helpers.mjs";

test.describe("Feature: UI gap coverage - profile and action preconditions", () => {
  test.describe("Task: invalid profile choices and report readiness checks", () => {
    test("renders unsupported tax-year and act/year mismatch validation codes through the UI", async ({ page }) => {
      await openCalculator(page);
      await setScenarioField(page, "period_type", "tax_year");
      await runValidate(page);
      await expect(page.getByTestId("validation-output")).toContainText("VAL_TAX_YEAR_RULEPACK_NOT_ACTIVE");

      await goToStep(page, "profile");
      await setScenarioField(page, "period_type", "assessment_year");
      await setScenarioField(page, "act", "Income-tax Act, 2025");
      await runValidate(page);
      await expect(page.getByTestId("validation-output")).toContainText("VAL_ACT_PERIOD_MISMATCH");
    });

    test("blocks JSON and HTML report downloads until an explanation report exists", async ({ page }) => {
      await openCalculator(page);
      await goToStep(page, "results");

      await clickAction(page, "download-json-button");
      await expectActionError(page, "Generate an explanation report before downloading JSON.");

      await clickAction(page, "download-html-button");
      await expectActionError(page, "Generate an explanation report before downloading HTML.");
    });
  });
});

test.describe("Feature: UI gap coverage - imports", () => {
  test.describe("Task: import field validation and recoverable preview warnings", () => {
    test("reports missing import type, filename, and content before preview", async ({ page }) => {
      await openCalculator(page);
      await goToStep(page, "imports");

      await clearScenarioField(page, "import_type");
      await clickAction(page, "preview-import-button");
      await expectActionError(page, "Preview import cannot run because Import type is missing.");

      await setScenarioField(page, "import_type", "form16");
      await clearScenarioField(page, "import_filename");
      await clickAction(page, "preview-import-button");
      await expectActionError(page, "Preview import cannot run because Filename is missing.");

      await page.getByTestId("import-filename").fill("form16.csv");
      await clearScenarioField(page, "import_content");
      await clickAction(page, "preview-import-button");
      await expectActionError(page, "Preview import cannot run because CSV, JSON, or extracted PDF content is missing.");
    });

    test("shows file-policy and capital-gains row warnings during preview", async ({ page }) => {
      await openCalculator(page);
      await goToStep(page, "imports");

      await page.getByTestId("import-filename").fill("form16.exe");
      await page.getByTestId("import-content").fill("gross_salary\n900000");
      await clickAction(page, "preview-import-button");
      await expectActionError(page, "Unsupported import file extension.");

      await page.getByTestId("import-type").selectOption("capital_gains");
      await page.getByTestId("import-filename").fill("capital_gains.csv");
      await page.getByTestId("import-content").fill("section,net_gain,stt_paid,asset_type\n112A,300000,true,equity");
      await clickAction(page, "preview-import-button");
      await expect(page.getByTestId("import-output")).toContainText("WARN_IMPORT_ROW_2_MISSING_TRANSFER_DATE");
    });
  });
});

test.describe("Feature: UI gap coverage - income, deductions, and credits", () => {
  test.describe("Task: income-head toggles and tax-boundary calculations", () => {
    test("excludes unchecked salary income while including selected other-source income", async ({ page }) => {
      await openCalculator(page);
      await goToStep(page, "income");
      await setIncomeHead(page, "salary", false);
      await setIncomeHead(page, "other_sources", true);
      await setScenarioField(page, "interest_income", 20000);

      await runCompute(page);
      await expect(page.getByTestId("result-output")).toContainText("₹20,000");
      await expect(page.getByTestId("result-output")).not.toContainText("₹12,75,000");
    });

    test("shows standard-deduction off and marginal-relief boundary amounts in UI", async ({ page }) => {
      await openCalculator(page);
      await fillSalaryScenario(page, 1275000);
      await goToStep(page, "deductions");
      await setScenarioField(page, "standard_deduction", false);
      await runCompute(page);
      await expect(page.getByTestId("result-output")).toContainText("₹12,75,000");
      await expect(page.getByTestId("result-output")).toContainText("₹74,100");

      await goToStep(page, "income");
      await setScenarioField(page, "gross_salary", 1280000);
      await goToStep(page, "deductions");
      await setScenarioField(page, "standard_deduction", true);
      await runCompute(page);
      await expect(page.getByTestId("result-output")).toContainText("₹5,200");
    });
  });

  test.describe("Task: deductions and credit combinations", () => {
    test("computes 80GG and combined manual credits from visible fields", async ({ page }) => {
      await openCalculator(page);
      await fillBaseProfile(page, { regime: "old" });
      await fillSalaryScenario(page, 800000);
      await goToStep(page, "deductions");
      await setScenarioField(page, "deduction_80gg_rent", 180000);
      await goToStep(page, "credits");
      await setScenarioField(page, "tds", 20000);
      await setScenarioField(page, "tcs", 5000);
      await setScenarioField(page, "advance_tax", 10000);
      await setScenarioField(page, "self_assessment_tax", 5000);

      await runCompute(page);
      await expect(page.getByTestId("result-output")).toContainText("Deductions");
      await expect(page.getByTestId("result-output")).toContainText("₹1,10,000");
      await expect(page.getByTestId("result-output")).toContainText("Credits");
      await expect(page.getByTestId("result-output")).toContainText("₹40,000");
    });
  });
});

test.describe("Feature: UI gap coverage - capital gains and presumptive business", () => {
  test.describe("Task: capital-gains sections and date-split tax rates", () => {
    for (const scenario of [
      { section: "111A", date: "2024-07-22", gain: 200000, expectedTax: 30000, expectedPayable: "₹31,200" },
      { section: "111A", date: "2024-07-23", gain: 200000, expectedTax: 40000, expectedPayable: "₹41,600" },
      { section: "112A", date: "2025-08-15", gain: 125000, expectedTax: 0, expectedPayable: "₹0" },
      { section: "112", date: "2025-08-15", gain: 400000, expectedTax: 50000, expectedPayable: "₹52,000" }
    ]) {
      test(`computes ${scenario.section} gain ${scenario.gain} transferred on ${scenario.date}`, async ({ page, request }) => {
        await openCalculator(page);
        await goToStep(page, "income");
        await setIncomeHead(page, "salary", false);
        await setIncomeHead(page, "capital_gains", true);
        await setScenarioField(page, "capital_gain_section", scenario.section);
        await setScenarioField(page, "capital_gain_transfer_date", scenario.date);
        await setScenarioField(page, "capital_gain_net_gain", scenario.gain);

        await runCompute(page);
        await expect(page.getByTestId("result-output")).toContainText(scenario.expectedPayable);

        const apiResult = await postJson(request, "/api/v1/tax/compute", withPayload({
          income: {
            capital_gains: [{
              section: scenario.section,
              transfer_date: scenario.date,
              net_gain: scenario.gain,
              stt_paid: true
            }]
          }
        }));
        expect(apiResult.summary.special_rate_tax[scenario.section]?.tax_before_cess ?? 0).toBe(scenario.expectedTax);
      });
    }
  });

  test.describe("Task: presumptive threshold warnings", () => {
    test("renders 44AD and 44ADA enhanced-threshold warnings for high cash receipts", async ({ page }) => {
      await openCalculator(page);
      await goToStep(page, "income");
      await setIncomeHead(page, "salary", false);
      await setIncomeHead(page, "business", true);
      await setScenarioField(page, "business_section", "44AD");
      await setScenarioField(page, "business_receipts", 25000000);
      await setScenarioField(page, "business_cash_receipts", 2000000);
      await setScenarioField(page, "business_digital_receipts", 23000000);

      await runValidate(page);
      await expect(page.getByTestId("validation-output")).toContainText("WARN_44AD_ENHANCED_THRESHOLD_UNAVAILABLE");

      await goToStep(page, "income");
      await setScenarioField(page, "business_section", "44ADA");
      await setScenarioField(page, "business_receipts", 7000000);
      await setScenarioField(page, "business_cash_receipts", 500000);
      await runValidate(page);
      await expect(page.getByTestId("validation-output")).toContainText("WARN_44ADA_ENHANCED_THRESHOLD_UNAVAILABLE");
    });
  });
});

test.describe("Feature: UI gap coverage - launch feedback", () => {
  test.describe("Task: explicit feedback category and severity values", () => {
    for (const [category, severity] of [
      ["calculation", "critical"],
      ["validation", "high"],
      ["ux", "medium"],
      ["security", "low"]
    ]) {
      test(`honors ${category} feedback with ${severity} severity`, async ({ page }) => {
        await openCalculator(page);
        await goToStep(page, "launch");
        await setScenarioField(page, "feedback_category", category);
        await setScenarioField(page, "feedback_severity", severity);
        await setScenarioField(page, "feedback_description", `${category} feedback should be classified with explicit ${severity} severity.`);

        await page.getByTestId("classify-feedback-button").click();
        await expect(page.getByTestId("launch-output")).toContainText(`Category${titleCase(category)}`);
        await expect(page.getByTestId("launch-output")).toContainText(`Severity${titleCase(severity)}`);
      });
    }
  });
});

function titleCase(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
