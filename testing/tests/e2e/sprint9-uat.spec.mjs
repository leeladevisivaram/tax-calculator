import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { assertNoInternalLabels, clickAction, goToStep, openCalculator } from "./helpers.mjs";

const sampleForm16Path = fileURLToPath(new URL("../../test-data/imports/sample-form16.csv", import.meta.url));
const sampleForm16PdfPath = fileURLToPath(new URL("../../test-data/imports/sample-form16.pdf", import.meta.url));
const unsupportedImportPath = fileURLToPath(new URL("../../test-data/imports/unsupported-form16.txt", import.meta.url));

test.describe("Feature: Sprint 9 document-upload imports", () => {
  test.describe("Task: supported document upload imports", () => {
    test("uploads a sample Form 16 CSV, previews mapped values, and applies after confirmation", async ({ page }) => {
      await openCalculator(page);
      await goToStep(page, "imports");

      await page.getByTestId("import-file").setInputFiles(sampleForm16Path);

      await expect(page.getByTestId("import-file-status")).toContainText("Loaded sample-form16.csv");
      await expect(page.getByTestId("import-filename")).toHaveValue("sample-form16.csv");
      await expect(page.getByTestId("import-content")).toContainText("900000");
      await expect(page.getByTestId("import-output")).toContainText("Import preview");
      await expect(page.getByTestId("import-output")).toContainText("income.salary.gross_salary");
      await expect(page.getByTestId("import-output")).toContainText("tax_credits.tds");

      await page.getByTestId("import-confirmed").check();
      await clickAction(page, "apply-import-button");

      await expect(page.getByTestId("gross-salary")).toHaveValue("900000");
      await expect(page.getByTestId("tds-input")).toHaveValue("45000");
      await assertNoInternalLabels(page);
    });

    test("rejects unsupported upload files with a clear message", async ({ page }) => {
      await openCalculator(page);
      await goToStep(page, "imports");

      await page.getByTestId("import-file").setInputFiles(unsupportedImportPath);

      await expect(page.getByTestId("import-file-status")).toContainText("Only CSV, JSON, and searchable PDF import files are supported");
      await expect(page.getByTestId("action-error")).toContainText("Only CSV, JSON, and searchable PDF import files are supported");
      await assertNoInternalLabels(page);
    });

    test("uploads a searchable Form 16 PDF, extracts values, and applies after confirmation", async ({ page }) => {
      await openCalculator(page);
      await goToStep(page, "imports");

      await page.getByTestId("import-file").setInputFiles(sampleForm16PdfPath);

      await expect(page.getByTestId("import-file-status")).toContainText("Extracted sample-form16.pdf");
      await expect(page.getByTestId("import-filename")).toHaveValue("sample-form16-extracted.csv");
      await expect(page.getByTestId("import-content")).toContainText("900000");
      await expect(page.getByTestId("pdf-extract-summary")).toContainText("PDF reader");
      await expect(page.getByTestId("import-output")).toContainText("income.salary.gross_salary");
      await expect(page.getByTestId("import-output")).toContainText("tax_credits.tds");
      await expect(page.getByTestId("field-confidence").first()).toContainText("confidence");
      await expect(page.getByTestId("ai-review-center")).toContainText("AI Review Center");

      await page.getByTestId("import-confirmed").check();
      await clickAction(page, "apply-import-button");

      await expect(page.getByTestId("gross-salary")).toHaveValue("900000");
      await expect(page.getByTestId("tds-input")).toHaveValue("45000");
      await assertNoInternalLabels(page);
    });
  });

});
