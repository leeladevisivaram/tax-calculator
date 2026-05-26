import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildServer } from "../../src/server.mjs";

describe("Feature: Taxpayer calculation journeys", () => {
  describe("Task: salary, comparison, capital gains, and presumptive flows", () => {
    it("runs supported calculation journeys from validation through report", async () => {
      await withServer(async (baseUrl) => {
        const salaryPayload = baseRequest({
          income: { salary: { gross_salary: 1275000 } },
          deductions: { standard_deduction: true },
          options: { include_validation: true }
        });
        const salaryValidation = await postJson(baseUrl, "/api/v1/tax/validate", salaryPayload);
        assert.equal(salaryValidation.summary.blockers, 0);

        const salaryCompute = await postJson(baseUrl, "/api/v1/tax/compute", salaryPayload);
        assert.equal(salaryCompute.summary.total_income, 1200000);
        assert.equal(salaryCompute.summary.net_tax_liability, 0);
        assert.equal(salaryCompute.validation_status, "ok");

        const salaryReport = await postJson(baseUrl, "/api/v1/reports/explain", salaryPayload);
        assert.equal(salaryReport.status, "ok");
        assert.ok(salaryReport.worksheet.some((line) => line.line_id === "net_tax_liability"));
        assert.ok(salaryReport.sources.length > 0);

        const comparison = await postJson(baseUrl, "/api/v1/tax/compare-regimes", baseRequest({
          income: { salary: { gross_salary: 900000 } },
          deductions: { standard_deduction: true, chapter_via: [{ section: "80C", amount: 150000 }] }
        }));
        assert.ok(["old", "new"].includes(comparison.recommended_regime));
        assert.equal(typeof comparison.delta, "number");

        const capitalGainPayload = baseRequest({
          income: {
            salary: { gross_salary: 1275000 },
            capital_gains: [{ section: "112A", transfer_date: "2025-08-15", net_gain: 300000, stt_paid: true }]
          },
          deductions: { standard_deduction: true }
        });
        const capitalGainValidation = await postJson(baseUrl, "/api/v1/tax/validate", capitalGainPayload);
        assert.ok(capitalGainValidation.warnings.includes("WARN_REBATE_SPECIAL_RATE_LIMIT"));
        const capitalGainCompute = await postJson(baseUrl, "/api/v1/tax/compute", capitalGainPayload);
        assert.ok(sumSpecialTax(capitalGainCompute.summary.special_rate_tax) > 0);

        const businessCompute = await postJson(baseUrl, "/api/v1/tax/compute", baseRequest({
          income: {
            business_profession: [{ section: "44AD", turnover: 25000000, cash_receipts: 1000000, digital_receipts: 24000000 }]
          },
          deductions: { standard_deduction: true }
        }));
        assert.equal(businessCompute.summary.business_profession["44AD"].deemed_income, 1520000);

        const professionCompute = await postJson(baseUrl, "/api/v1/tax/compute", baseRequest({
          income: {
            business_profession: [{ section: "44ADA", gross_receipts: 7000000, cash_receipts: 100000 }]
          },
          deductions: { standard_deduction: true }
        }));
        assert.equal(professionCompute.summary.business_profession["44ADA"].deemed_income, 3500000);
      });
    });
  });
});

describe("Feature: Import and reporting journeys", () => {
  describe("Task: import preview to compute and report", () => {
    it("requires confirmation before imported data affects computation", async () => {
      await withServer(async (baseUrl) => {
        const previewPayload = {
          import_type: "form16",
          filename: "form16.csv",
          content: "gross_salary,tds,deduction_80c,employer_name\n900000,45000,150000,Example Employer"
        };
        const unconfirmed = await postJson(baseUrl, "/api/v1/imports/preview", previewPayload);
        assert.equal(unconfirmed.confirmation_required, true);
        assert.deepEqual(unconfirmed.confirmed_request_patch, {});

        const confirmed = await postJson(baseUrl, "/api/v1/imports/preview", {
          ...previewPayload,
          user_confirmed: true
        });
        assert.equal(confirmed.confirmation_required, false);
        assert.equal(confirmed.confirmed_request_patch.income.salary.gross_salary, 900000);

        const request = deepMerge(baseRequest({ regime: "old" }), confirmed.confirmed_request_patch);
        const compute = await postJson(baseUrl, "/api/v1/tax/compute", request);
        assert.equal(compute.summary.gross_total_income, 900000);
        assert.equal(compute.summary.tax_credits, 45000);

        const report = await postJson(baseUrl, "/api/v1/reports/explain", request);
        assert.ok(report.support.computation_hash);
        assert.ok(report.downloads.json_filename.endsWith(".json"));
        assert.ok(report.report_html.includes("Tax calculation report"));
      });
    });
  });
});

describe("Feature: Release readiness journeys", () => {
  describe("Task: privacy, operations, and launch gates", () => {
    it("runs privacy controls, ops metrics, and launch readiness flows", async () => {
      await withServer(async (baseUrl) => {
        const policy = await getJson(baseUrl, "/api/v1/privacy/policy");
        assert.ok(policy.data_categories.some((category) => category.category === "income"));

        const exported = await postJson(baseUrl, "/api/v1/privacy/export", {
          profile: { period: "2026-27", regime: "new" },
          draft: { gross_salary: 900000 }
        });
        assert.equal(exported.package.draft.gross_salary, 900000);

        const deletion = await postJson(baseUrl, "/api/v1/privacy/delete", {});
        assert.ok(deletion.browser_actions.some((action) => action.includes("localStorage")));

        const runbook = await getJson(baseUrl, "/api/v1/ops/runbook");
        assert.ok(runbook.rollback_process.length >= 3);

        const metrics = await getJson(baseUrl, "/api/v1/ops/metrics");
        assert.equal(metrics.status, "ok");
        assert.ok(metrics.by_route["POST /api/v1/privacy/export"].count >= 1);

        const regression = await getJson(baseUrl, "/api/v1/launch/regression");
        assert.equal(regression.machine_gate_status, "pass");
        assert.equal(regression.golden_vectors.failed, 0);

        const pendingReadiness = await getJson(baseUrl, "/api/v1/launch/readiness");
        assert.equal(pendingReadiness.public_launch_status, "blocked_pending_stakeholder_signoff");

        const approvedReadiness = await postJson(baseUrl, "/api/v1/launch/readiness", {
          approvals: {
            product: "approved",
            engineering: "approved",
            tax_domain: "approved"
          },
          open_defects: []
        });
        assert.equal(approvedReadiness.public_launch_status, "go");

        const blocker = await postJson(baseUrl, "/api/v1/launch/triage", {
          description: "Wrong tax amount for 112A after date split."
        });
        assert.equal(blocker.category, "calculation");
        assert.equal(blocker.launch_blocker, true);
      });
    });
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

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  assert.equal(response.status, 200);
  return response.json();
}

async function postJson(baseUrl, path, payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.equal(response.status, 200);
  return response.json();
}

function sumSpecialTax(specialRateTax = {}) {
  return Object.values(specialRateTax).reduce((total, item) => {
    return total + (item.tax_before_cess ?? item.final_tax_before_cess ?? 0);
  }, 0);
}

function deepMerge(target, source) {
  const output = Array.isArray(target) ? [...target] : { ...target };
  for (const [key, value] of Object.entries(source ?? {})) {
    if (Array.isArray(value)) {
      output[key] = value;
    } else if (value && typeof value === "object") {
      output[key] = deepMerge(output[key] ?? {}, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}
