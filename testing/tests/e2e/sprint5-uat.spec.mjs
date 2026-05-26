import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  clickAction,
  fillSalaryScenario,
  openCalculator,
  runExplain,
  setIncomeHead,
  setScenarioField
} from "./helpers.mjs";

test.describe("Sprint 5 UAT: Calculation Worksheet UI", () => {
  test("TC-S5-005 displays the worksheet for user review", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 1275000);
    await runExplain(page);

    await expect(page.getByTestId("worksheet-table")).toContainText("Gross total income");
    await expect(page.getByTestId("worksheet-table")).toContainText("Net tax liability");
    await expect(page.getByTestId("worksheet-table")).toContainText("slab");
    await expect(page.getByTestId("report-assumptions")).toContainText("assessment_year 2026-27");
  });
});

test.describe("Sprint 5 UAT: Source Evidence UI", () => {
  test("TC-S5-013 displays source evidence titles and retrieval dates", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 1275000);
    await runExplain(page);

    await expect(page.getByTestId("source-table")).toContainText("SRC-ITD-SALARIED-AY2026");
    await expect(page.getByTestId("source-table")).toContainText("Salaried Individuals");
    await expect(page.getByTestId("source-table")).toContainText("2026-05-08");
  });

  test("TC-S5-014 displays citation notes for ambiguous source evidence", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 1275000);
    await setIncomeHead(page, "capital_gains", true);
    await setScenarioField(page, "capital_gain_section", "112A");
    await setScenarioField(page, "capital_gain_transfer_date", "2025-08-15");
    await setScenarioField(page, "capital_gain_net_gain", 300000);
    await runExplain(page);

    await expect(page.getByTestId("citation-notes")).toContainText("SRC-SECTION-112A");
    await expect(page.getByTestId("citation-notes")).toContainText("Domain review must confirm");
    await expect(page.getByTestId("report-warning-section")).toContainText("WARN_REBATE_SPECIAL_RATE_LIMIT");
  });
});

test.describe("Sprint 5 UAT: Downloadable Reports UI", () => {
  test("TC-S5-016 downloads JSON report with input, result, and trace evidence", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 1275000);
    await runExplain(page);

    const downloadPromise = page.waitForEvent("download");
    await clickAction(page, "download-json-button");
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/tax-report.*\.json$/);

    const filePath = await download.path();
    const report = JSON.parse(await readFile(filePath, "utf8"));
    expect(report.summary.net_tax_liability).toBe(0);
    expect(report.worksheet.some((line) => line.rule_ids.length > 0)).toBeTruthy();
    expect(report.sources.some((source) => source.source_id === "SRC-ITD-SALARIED-AY2026")).toBeTruthy();
  });

  test("TC-S5-017 downloads print-ready HTML report", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 1275000);
    await runExplain(page);

    const downloadPromise = page.waitForEvent("download");
    await clickAction(page, "download-html-button");
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/tax-report.*\.html$/);

    const filePath = await download.path();
    const html = await readFile(filePath, "utf8");
    expect(html).toContain("Tax calculation report");
    expect(html).toContain("Worksheet");
    expect(html).toContain("Source Evidence");
    expect(html).toContain("Likely ITR form");
    expect(html).not.toMatch(/Sprint \d|sprint\d+-v\d+|sprint-zero/i);
  });
});
