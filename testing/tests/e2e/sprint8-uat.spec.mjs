import { expect, test } from "@playwright/test";
import {
  assertNoInternalLabels,
  clickAction,
  expectActionError,
  fillSalaryScenario,
  getJson,
  goToStep,
  openCalculator,
  postJson,
  runCompare,
  runCompute,
  runExplain,
  setIncomeHead,
  setScenarioField
} from "./helpers.mjs";

test.describe("Sprint 8 UAT: Closed Beta UI", () => {
  test("TC-S8-001 completes the salaried beta flow through report review", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 900000);
    await goToStep(page, "deductions");
    await setScenarioField(page, "deduction_80c", 150000);
    await goToStep(page, "results");

    await runCompute(page);
    await runCompare(page);
    await runExplain(page);

    await expect(page.getByTestId("result-output")).toContainText("Likely ITR form");
    await expect(page.getByTestId("report-disclaimer")).toContainText("not a substitute for professional tax advice");
    await assertNoInternalLabels(page);
  });

  test("TC-S8-002 completes the investor capital-gains beta flow", async ({ page, request }) => {
    await openCalculator(page);
    await goToStep(page, "income");
    await setIncomeHead(page, "capital_gains", true);
    await setScenarioField(page, "capital_gain_section", "112A");
    await setScenarioField(page, "capital_gain_transfer_date", "2025-08-15");
    await setScenarioField(page, "capital_gain_net_gain", 300000);
    await goToStep(page, "results");

    await runCompute(page);

    await expect(page.getByTestId("result-output")).toContainText("Special-rate tax");
    await expect(page.getByTestId("result-output")).toContainText("ITR-2");
    const apiResult = await postJson(request, "/api/v1/tax/compute", {
      period_type: "assessment_year",
      period: "2026-27",
      act: "Income-tax Act, 1961",
      taxpayer_type: "individual",
      residency: "resident",
      age_years: 34,
      regime: "new",
      income: {
        salary: { gross_salary: 1275000 },
        capital_gains: [{ section: "112A", transfer_date: "2025-08-15", net_gain: 300000, stt_paid: true }]
      },
      deductions: { standard_deduction: true },
      tax_credits: {}
    });
    expect(apiResult.summary.special_rate_tax["112A"].taxable_gain).toBe(175000);
  });

  test("TC-S8-003 completes the freelancer 44ADA beta flow", async ({ page, request }) => {
    await openCalculator(page);
    await goToStep(page, "income");
    await setIncomeHead(page, "salary", false);
    await setIncomeHead(page, "business", true);
    await setScenarioField(page, "business_section", "44ADA");
    await setScenarioField(page, "business_receipts", 7000000);
    await setScenarioField(page, "business_cash_receipts", 100000);
    await goToStep(page, "results");

    await runCompute(page);

    await expect(page.getByTestId("result-output")).toContainText("ITR-4");
    const apiResult = await postJson(request, "/api/v1/tax/compute", {
      period_type: "assessment_year",
      period: "2026-27",
      act: "Income-tax Act, 1961",
      taxpayer_type: "individual",
      residency: "resident",
      age_years: 34,
      regime: "new",
      income: { business_profession: [{ section: "44ADA", gross_receipts: 7000000, cash_receipts: 100000 }] },
      deductions: { standard_deduction: true },
      tax_credits: {}
    });
    expect(apiResult.summary.business_profession["44ADA"].deemed_income).toBe(3500000);
  });

  test("TC-S8-004 completes the proprietor 44AD beta flow", async ({ page, request }) => {
    await openCalculator(page);
    await goToStep(page, "income");
    await setIncomeHead(page, "salary", false);
    await setIncomeHead(page, "business", true);
    await setScenarioField(page, "business_section", "44AD");
    await setScenarioField(page, "business_receipts", 25000000);
    await setScenarioField(page, "business_cash_receipts", 1000000);
    await setScenarioField(page, "business_digital_receipts", 24000000);
    await goToStep(page, "results");

    await runCompute(page);

    await expect(page.getByTestId("result-output")).toContainText("ITR-4");
    const apiResult = await postJson(request, "/api/v1/tax/compute", {
      period_type: "assessment_year",
      period: "2026-27",
      act: "Income-tax Act, 1961",
      taxpayer_type: "individual",
      residency: "resident",
      age_years: 34,
      regime: "new",
      income: { business_profession: [{ section: "44AD", turnover: 25000000, cash_receipts: 1000000, digital_receipts: 24000000 }] },
      deductions: { standard_deduction: true },
      tax_credits: {}
    });
    expect(apiResult.summary.business_profession["44AD"].deemed_income).toBe(1520000);
  });

  test("TC-S8-005 supports senior citizen beta slab review", async ({ page }) => {
    await openCalculator(page);
    await setScenarioField(page, "age_years", 65);
    await setScenarioField(page, "regime", "old");
    await fillSalaryScenario(page, 650000);
    await goToStep(page, "results");

    await runCompute(page);

    await expect(page.getByTestId("result-output")).toContainText("Likely ITR form");
    await expect(page.getByTestId("result-output")).toContainText("Payable / refund");
  });

  test("TC-S8-007 validates and classifies beta feedback", async ({ page }) => {
    await openCalculator(page);
    await goToStep(page, "launch");

    await page.getByTestId("feedback-description").fill("");
    await page.getByTestId("classify-feedback-button").click();
    await expectActionError(page, "Classify feedback cannot run because Feedback is missing.");

    await page.getByTestId("feedback-description").fill("Wrong tax amount for 112A after date split.");
    await page.getByTestId("classify-feedback-button").click();
    await expect(page.getByTestId("launch-output")).toContainText("Launch blocker");
    await expect(page.getByTestId("launch-output")).toContainText("Calculation");
  });
});

test.describe("Sprint 8 UAT: Regression And Launch UI", () => {
  test("TC-S8-009 to TC-S8-016 displays final regression gate evidence", async ({ page, request }) => {
    await openCalculator(page);
    await goToStep(page, "launch");

    await page.getByTestId("run-regression-button").click();

    await expect(page.getByTestId("launch-output")).toContainText("Final regression");
    await expect(page.getByTestId("launch-output")).toContainText("30/30");
    await expect(page.getByTestId("launch-output")).toContainText("Capital Gains Split Dates");
    await expect(page.getByTestId("launch-output")).toContainText("Import Mapping");

    const regression = await getJson(request, "/api/v1/launch/regression");
    expect(regression.machine_gate_status).toBe("pass");
    expect(regression.golden_vectors.failed).toBe(0);
    expect(regression.source_register.status).toBe("finalized_for_v1_launch");
  });

  test("TC-S8-017 to TC-S8-024 displays disclaimer, support SOP, changelog, last-updated date, and rollback", async ({ page }) => {
    await openCalculator(page);
    await expect(page.getByText("2026-05-08").first()).toBeVisible();

    await goToStep(page, "launch");
    await page.getByTestId("support-sop-button").click();

    await expect(page.getByTestId("launch-output")).toContainText("Support SOP");
    await expect(page.getByTestId("launch-output")).toContainText("not a substitute for professional tax advice");
    await expect(page.getByTestId("launch-output")).toContainText("updated 2026-05-08");
    await expect(page.getByTestId("launch-output")).toContainText("Rerun golden vectors");
    await assertNoInternalLabels(page);
  });

  test("TC-S8-022 downloads report artifacts from the browser", async ({ page }) => {
    await openCalculator(page);
    await fillSalaryScenario(page, 1275000);
    await goToStep(page, "results");
    await runCompute(page);
    await runExplain(page);

    const jsonDownloadPromise = page.waitForEvent("download");
    await clickAction(page, "download-json-button");
    const jsonDownload = await jsonDownloadPromise;
    expect(jsonDownload.suggestedFilename()).toMatch(/^tax-report-[a-f0-9]{12}\.json$/);

    const htmlDownloadPromise = page.waitForEvent("download");
    await clickAction(page, "download-html-button");
    const htmlDownload = await htmlDownloadPromise;
    expect(htmlDownload.suggestedFilename()).toMatch(/^tax-report-[a-f0-9]{12}\.html$/);
  });

  test("TC-S8-025 to TC-S8-028 enforces approval gates through launch readiness API", async ({ request }) => {
    const pending = await getJson(request, "/api/v1/launch/readiness");
    expect(pending.public_launch_status).toBe("blocked_pending_stakeholder_signoff");

    const productMissing = await postJson(request, "/api/v1/launch/readiness", {
      approvals: { engineering: "approved", tax_domain: "approved" },
      open_defects: []
    });
    expect(productMissing.gates.find((gate) => gate.gate === "stakeholder_approval").approvals.product).toBe("pending");

    const engineeringMissing = await postJson(request, "/api/v1/launch/readiness", {
      approvals: { product: "approved", tax_domain: "approved" },
      open_defects: []
    });
    expect(engineeringMissing.gates.find((gate) => gate.gate === "stakeholder_approval").approvals.engineering).toBe("pending");

    const taxMissing = await postJson(request, "/api/v1/launch/readiness", {
      approvals: { product: "approved", engineering: "approved" },
      open_defects: []
    });
    expect(taxMissing.gates.find((gate) => gate.gate === "stakeholder_approval").approvals.tax_domain).toBe("pending");

    const approved = await postJson(request, "/api/v1/launch/readiness", {
      approvals: { product: "approved", engineering: "approved", tax_domain: "approved" },
      open_defects: []
    });
    expect(approved.public_launch_status).toBe("go");
  });
});
