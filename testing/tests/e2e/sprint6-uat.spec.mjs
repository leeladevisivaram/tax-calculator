import { expect, test } from "@playwright/test";
import {
  clickAction,
  fillBaseProfile,
  goToStep,
  openCalculator,
  runCompute
} from "./helpers.mjs";

const form16Content = "gross_salary,tds,deduction_80c,employer_name\n900000,45000,150000,Example Employer";

test.describe("Sprint 6 UAT: Form 16 Import UI", () => {
  test("TC-S6-015 displays confidence for parsed Form 16 fields", async ({ page }) => {
    await openCalculator(page);
    await goToStep(page, "imports");
    await fillImport(page, "form16", "form16.csv", form16Content);
    await clickAction(page, "preview-import-button");

    await expect(page.getByTestId("import-output")).toContainText("Import preview");
    await expect(page.getByTestId("import-review-item").first()).toContainText("high confidence");
    await expect(page.getByTestId("import-output")).toContainText("income.salary.gross_salary");
    await expect(page.getByTestId("import-output")).toContainText("tax_credits.tds");
  });

  test("TC-S6-016 applies confirmed mapped salary, TDS, and 80C fields", async ({ page }) => {
    await openCalculator(page);
    await goToStep(page, "imports");
    await fillImport(page, "form16", "form16.csv", form16Content);
    await page.getByTestId("import-confirmed").check();
    await clickAction(page, "apply-import-button");
    await expect(page.locator("[name='gross_salary']")).toHaveValue("900000");
    await expect(page.locator("[name='tds']")).toHaveValue("45000");

    await expect(page.getByTestId("panel-income")).toBeVisible();
    await expect(page.locator("[name='gross_salary']")).toHaveValue("900000");
    await expect(page.locator("[name='tds']")).toHaveValue("45000");
    await expect(page.locator("[name='deduction_80c']")).toHaveValue("150000");
  });

  test("TC-S6-017 lets the user reject imported tax-credit values before apply", async ({ page }) => {
    await openCalculator(page);
    await goToStep(page, "imports");
    await fillImport(page, "form16", "form16.csv", form16Content);
    await page.getByTestId("import-confirmed").check();
    await page.getByTestId("import-reject-credits").check();
    await clickAction(page, "apply-import-button");

    await expect(page.locator("[name='gross_salary']")).toHaveValue("900000");
    await expect(page.locator("[name='deduction_80c']")).toHaveValue("150000");
    await expect(page.locator("[name='tds']")).toHaveValue("0");
  });
});

test.describe("Sprint 6 UAT: Import Review and Regression UI", () => {
  test("TC-S6-025 shows unknown import fields in the review queue", async ({ page }) => {
    await openCalculator(page);
    await goToStep(page, "imports");
    await fillImport(page, "form16", "form16.csv", "gross_salary,tds,unexpected_column\n900000,45000,ignored");
    await clickAction(page, "preview-import-button");

    await expect(page.getByTestId("import-output")).toContainText("WARN_IMPORT_UNKNOWN_FIELDS");
    await expect(page.getByTestId("import-output")).toContainText("Unknown fields");
    await expect(page.getByTestId("import-output")).toContainText("unexpected_column");
  });

  test("TC-S6-028 confirms import, computes from imported values, and displays the correct result", async ({ page }) => {
    await openCalculator(page);
    await fillBaseProfile(page, { regime: "old" });
    await goToStep(page, "imports");
    await fillImport(page, "form16", "form16.csv", form16Content);
    await page.getByTestId("import-confirmed").check();
    await clickAction(page, "apply-import-button");
    await expect(page.locator("[name='gross_salary']")).toHaveValue("900000");
    await expect(page.locator("[name='tds']")).toHaveValue("45000");

    await runCompute(page);
    await expect(page.getByTestId("result-output")).toContainText("₹9,600");
    await expect(page.getByTestId("result-output")).toContainText("Gross total income");
  });
});

async function fillImport(page, importType, filename, content) {
  await page.getByTestId("import-type").selectOption(importType);
  await page.getByTestId("import-filename").fill(filename);
  await page.getByTestId("import-content").fill(content);
}
