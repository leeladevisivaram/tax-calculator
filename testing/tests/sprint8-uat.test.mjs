import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { previewImport } from "../../src/import-engine.mjs";
import {
  classifyBetaFeedback,
  getBetaPlan,
  getLaunchReadiness,
  getLegalAndSupportReadiness,
  runFinalRegression
} from "../../src/launch-engine.mjs";
import { getMetrics, getRunbook } from "../../src/ops-engine.mjs";
import { explainTaxRequest } from "../../src/report-engine.mjs";
import { listSupportedPeriods } from "../../src/rulepack-loader.mjs";
import { buildServer } from "../../src/server.mjs";
import { computeTax } from "../../src/tax-engine.mjs";
import { validateTaxRequest } from "../../src/validation-engine.mjs";

let regressionCache;
const getRegression = () => regressionCache ??= runFinalRegression();

describe("Sprint 8 UAT: Closed Beta", () => {
  it("TC-S8-001 supports the salaried beta flow and captures confidence feedback", async () => {
    const report = await explainTaxRequest(baseRequest({
      regime: "old",
      income: { salary: { gross_salary: 900000 } },
      deductions: {
        standard_deduction: true,
        chapter_via: [{ section: "80C", amount: 150000 }]
      }
    }));
    const feedback = classifyBetaFeedback({
      category: "ux",
      severity: "low",
      description: "Salaried flow gave confidence after old-vs-new comparison and report review."
    });

    assert.equal(report.status, "ok");
    assert.equal(report.itr_recommendation, "ITR-1");
    assert.match(report.metadata.disclaimer, /not a substitute for professional tax advice/i);
    assert.equal(feedback.launch_blocker, false);
  });

  it("TC-S8-002 supports the investor beta flow with capital-gains workflow evidence", async () => {
    const result = await computeTax(baseRequest({
      income: {
        salary: { gross_salary: 1275000 },
        capital_gains: [{ section: "112A", transfer_date: "2025-08-15", net_gain: 300000, stt_paid: true }]
      }
    }));

    assert.equal(result.status, "ok");
    assert.equal(result.itr_recommendation, "ITR-2");
    assert.equal(result.summary.capital_gains[0].section, "112A");
    assert.equal(result.summary.special_rate_tax["112A"].taxable_gain, 175000);
  });

  it("TC-S8-003 supports the freelancer beta flow with 44ADA and ITR recommendation", async () => {
    const result = await computeTax(baseRequest({
      income: { business_profession: [{ section: "44ADA", gross_receipts: 7000000, cash_receipts: 100000 }] }
    }));

    assert.equal(result.status, "ok");
    assert.equal(result.itr_recommendation, "ITR-4");
    assert.equal(result.summary.business_profession["44ADA"].deemed_income, 3500000);
  });

  it("TC-S8-004 supports the proprietor beta flow with 44AD tax-confidence evidence", async () => {
    const result = await computeTax(baseRequest({
      income: { business_profession: [{ section: "44AD", turnover: 25000000, cash_receipts: 1000000, digital_receipts: 24000000 }] }
    }));
    const feedback = classifyBetaFeedback({
      category: "content",
      severity: "low",
      description: "44AD confidence copy was clear for presumptive income."
    });

    assert.equal(result.status, "ok");
    assert.equal(result.summary.business_profession["44AD"].deemed_income, 1520000);
    assert.equal(feedback.launch_blocker, false);
  });

  it("TC-S8-005 supports senior citizen beta review with senior old-regime slab selection", async () => {
    const result = await computeTax(baseRequest({
      regime: "old",
      age_years: 65,
      income: { salary: { gross_salary: 650000 } }
    }));

    assert.equal(result.status, "ok");
    assert.ok(result.rule_trace.includes("slab.old.ay2026.individual.senior"));
  });

  it("TC-S8-006 provides tax-professional report review evidence", async () => {
    const report = await explainTaxRequest(baseRequest({
      income: {
        salary: { gross_salary: 1275000 },
        capital_gains: [{ section: "112A", transfer_date: "2025-08-15", net_gain: 300000, stt_paid: true }]
      }
    }));

    assert.ok(report.worksheet.length > 5);
    assert.ok(report.sources.length > 0);
    assert.match(report.support.computation_hash, /^[a-f0-9]{64}$/);
    assert.ok(report.rule_trace.every((rule) => rule.sources.length > 0));
  });

  it("TC-S8-007 classifies beta defects into triage-ready taxonomy", () => {
    const calculation = classifyBetaFeedback({
      description: "Wrong tax amount for 112A after date split."
    });
    const content = classifyBetaFeedback({
      category: "content",
      severity: "low",
      description: "Label casing could be clearer."
    });

    assert.equal(calculation.category, "calculation");
    assert.equal(calculation.severity, "high");
    assert.equal(calculation.launch_blocker, true);
    assert.match(calculation.defect_id, /^BETA-[A-F0-9]{12}$/);
    assert.equal(content.launch_blocker, false);
  });

  it("TC-S8-008 controls scope expansion after beta freeze", () => {
    const plan = getBetaPlan();
    const featureRequest = classifyBetaFeedback({
      description: "Feature request: add a crypto tax module for public launch."
    });

    assert.equal(plan.scope_freeze.status, "frozen_for_v1");
    assert.ok(plan.scope_freeze.disallowed_changes.includes("new tax provisions"));
    assert.equal(featureRequest.launch_blocker, false);
    assert.equal(featureRequest.scope_freeze_action, "requires_product_approval_if_scope_expanding");
  });
});

describe("Sprint 8 UAT: Final Regression", () => {
  it("TC-S8-009 runs all approved golden vectors at 100 percent pass rate", async () => {
    const regression = await getRegression();

    assert.equal(regression.machine_gate_status, "pass");
    assert.equal(regression.golden_vectors.total, 30);
    assert.equal(regression.golden_vectors.failed, 0);
    assert.equal(regression.golden_vectors.pass_rate, 1);
  });

  it("TC-S8-010 reports historical period support and explicit unsupported periods", async () => {
    const regression = await getRegression();
    const periods = await listSupportedPeriods();

    assert.deepEqual(periods.map((period) => period.period), ["2025-26", "2026-27"]);
    assert.equal(regression.period_coverage.find((item) => item.period === "2024-25").status, "excluded_from_current_runtime");
    assert.equal(regression.period_coverage.find((item) => item.period === "2026-27").status, "active");
  });

  it("TC-S8-011 keeps the capital-gains split-date regression suite green", async () => {
    const regression = await getRegression();
    const suite = regression.regression_suites.find((item) => item.suite_id === "capital_gains_split_dates");

    assert.equal(suite.status, "pass");
    assert.match(suite.evidence, /111A\/112\/112A\/50AA/);
  });

  it("TC-S8-012 keeps import mapping preview and confirmation surfaces available", async () => {
    const preview = await previewImport({
      import_type: "form16",
      filename: "form16.csv",
      content: "gross_salary,tds,deduction_80c,employer_name\n900000,45000,150000,Example Employer"
    });

    assert.equal(preview.status, "ok");
    assert.ok(preview.review_items.some((item) => item.path === "income.salary.gross_salary"));
    assert.ok(preview.review_items.every((item) => item.confirmation_status === "requires_user_confirmation"));
  });

  it("TC-S8-013 keeps the security suite gate passing", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    });
  });

  it("TC-S8-014 keeps the accessibility gate passing", async () => {
    const readiness = await getLaunchReadiness();
    const accessibility = readiness.gates.find((gate) => gate.gate === "accessibility");

    assert.equal(accessibility.status, "pass");
    assert.match(accessibility.evidence, /skip_link:pass/);
    assert.match(accessibility.evidence, /focus_styles:pass/);
  });

  it("TC-S8-015 keeps final regression within launch performance budget", async () => {
    const startedAt = performance.now();
    const regression = await getRegression();
    const elapsedMs = performance.now() - startedAt;

    assert.equal(regression.machine_gate_status, "pass");
    assert.ok(elapsedMs < 5000, `final regression took ${elapsedMs}ms`);
  });

  it("TC-S8-016 keeps unsupported-scope messaging explicit", () => {
    const unsupportedPeriod = validateTaxRequest(baseRequest({ period: "2024-25" }));
    const unsupportedTaxpayer = validateTaxRequest(baseRequest({ taxpayer_type: "company" }));

    assert.equal(unsupportedPeriod.status, "blocked");
    assert.ok(unsupportedPeriod.results.some((item) => item.code === "VAL_PERIOD_UNSUPPORTED"));
    assert.equal(unsupportedTaxpayer.status, "blocked");
    assert.ok(unsupportedTaxpayer.results.some((item) => /individual and HUF taxpayers only/i.test(item.remediation_hint)));
  });
});

describe("Sprint 8 UAT: Launch Readiness", () => {
  it("TC-S8-017 includes legal disclaimer in reports and support payload", async () => {
    const report = await explainTaxRequest(baseRequest({ income: { salary: { gross_salary: 1275000 } } }));
    const support = getLegalAndSupportReadiness();

    assert.match(report.metadata.disclaimer, /not a substitute for professional tax advice/i);
    assert.match(report.report_html, /Important disclaimer/);
    assert.match(support.disclaimer.text, /official filing validation/);
  });

  it("TC-S8-018 publishes support SOP for launch support workflow", () => {
    const support = getLegalAndSupportReadiness();

    assert.ok(support.support_sop.some((item) => item.includes("computation hash")));
    assert.ok(support.support_sop.some((item) => item.includes("Classify the case")));
  });

  it("TC-S8-019 finalizes the source register used by active launch rules", async () => {
    const sourceRegister = await readJson("../../sprint-zero/source-register.json");
    const regression = await getRegression();

    assert.equal(sourceRegister.status, "finalized_for_v1_launch");
    assert.equal(regression.source_register.status, "finalized_for_v1_launch");
    assert.ok(regression.source_register.source_count >= 10);
  });

  it("TC-S8-020 publishes active rulepack changelog entries", () => {
    const support = getLegalAndSupportReadiness();

    assert.ok(support.rulepack_changelog.some((item) => item.rulepack_id === "ay-2026-27-v1"));
    assert.ok(support.rulepack_changelog.every((item) => item.last_updated === "2026-05-08"));
  });

  it("TC-S8-021 exposes rulepack last-updated metadata", async () => {
    const report = await explainTaxRequest(baseRequest({ income: { salary: { gross_salary: 1275000 } } }));

    assert.equal(report.metadata.source_register_retrieved_on, "2026-05-08");
    assert.equal(report.metadata.source_register_version, "src-2026-05-08-v1");
  });

  it("TC-S8-022 verifies downloadable report artifacts", async () => {
    const report = await explainTaxRequest(baseRequest({ income: { salary: { gross_salary: 1275000 } } }));

    assert.match(report.downloads.json_filename, /^tax-report-[a-f0-9]{12}\.json$/);
    assert.match(report.downloads.html_filename, /^tax-report-[a-f0-9]{12}\.html$/);
    assert.match(report.report_html, /Tax calculation report/);
  });

  it("TC-S8-023 verifies production observability surfaces", async () => {
    await withServer(async (baseUrl) => {
      await fetch(`${baseUrl}/health`);
      await fetch(`${baseUrl}/api/v1/launch/readiness`);
    });
    const metrics = getMetrics();

    assert.equal(metrics.status, "ok");
    assert.ok(metrics.by_route["GET /health"].count >= 1);
    assert.ok(metrics.by_route["GET /api/v1/launch/readiness"].count >= 1);
    assert.equal(metrics.security.headers, "enabled");
  });

  it("TC-S8-024 publishes rollback process and launch rollback plan", () => {
    const runbook = getRunbook();
    const support = getLegalAndSupportReadiness();

    assert.ok(runbook.rollback_process.some((item) => item.includes("Reactivate")));
    assert.ok(support.launch_rollback_plan.some((item) => item.includes("Rerun golden vectors")));
  });

  it("TC-S8-025 blocks public launch when product approval is missing", async () => {
    const readiness = await getLaunchReadiness({
      approvals: { engineering: "approved", tax_domain: "approved" },
      open_defects: []
    });

    assert.equal(readiness.public_launch_status, "blocked_pending_stakeholder_signoff");
    assert.equal(readiness.gates.find((gate) => gate.gate === "stakeholder_approval").approvals.product, "pending");
  });

  it("TC-S8-026 blocks public launch when engineering approval is missing", async () => {
    const readiness = await getLaunchReadiness({
      approvals: { product: "approved", tax_domain: "approved" },
      open_defects: []
    });

    assert.equal(readiness.public_launch_status, "blocked_pending_stakeholder_signoff");
    assert.equal(readiness.gates.find((gate) => gate.gate === "stakeholder_approval").approvals.engineering, "pending");
  });

  it("TC-S8-027 blocks public launch when tax-domain approval is missing", async () => {
    const readiness = await getLaunchReadiness({
      approvals: { product: "approved", engineering: "approved" },
      open_defects: []
    });

    assert.equal(readiness.public_launch_status, "blocked_pending_stakeholder_signoff");
    assert.equal(readiness.gates.find((gate) => gate.gate === "stakeholder_approval").approvals.tax_domain, "pending");
  });

  it("TC-S8-028 allows public release only when machine gates and approvals pass", async () => {
    const readiness = await getLaunchReadiness({
      approvals: {
        product: "approved",
        engineering: "approved",
        tax_domain: "approved"
      },
      open_defects: []
    });

    assert.equal(readiness.machine_gate_status, "pass");
    assert.equal(readiness.public_launch_status, "go");
    assert.equal(readiness.open_defect_summary.launch_blockers, 0);
  });
});

function baseRequest(overrides = {}) {
  return {
    period_type: "assessment_year",
    period: "2026-27",
    act: "Income-tax Act, 1961",
    taxpayer_type: "individual",
    residency: "resident",
    age_years: 34,
    regime: "new",
    income: {},
    deductions: { standard_deduction: true },
    tax_credits: {},
    ...overrides
  };
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));
}

async function withServer(callback) {
  const server = buildServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await callback(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
