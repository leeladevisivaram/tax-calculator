import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildServer } from "../../src/server.mjs";

describe("Feature: Service availability", () => {
  describe("Task: serve health and static UI", () => {
    it("returns health and static application assets", async () => {
      await withServer(async (baseUrl) => {
        const health = await getJson(baseUrl, "/health");
        assert.equal(health.status, "ok");
        assert.ok(health.audit_id);

        const html = await fetch(`${baseUrl}/`);
        assert.equal(html.status, 200);
        assert.match(html.headers.get("content-type"), /text\/html/);
        assert.match(await html.text(), /id="tax-wizard"/);

        const css = await fetch(`${baseUrl}/styles.css`);
        assert.equal(css.status, 200);
        assert.match(css.headers.get("content-type"), /text\/css/);

        const js = await fetch(`${baseUrl}/app.js`);
        assert.equal(js.status, 200);
        assert.match(js.headers.get("content-type"), /text\/javascript/);

        const uiValidation = await fetch(`${baseUrl}/ui-validation.js`);
        assert.equal(uiValidation.status, 200);
        assert.match(uiValidation.headers.get("content-type"), /text\/javascript/);
      });
    });
  });
});

describe("Feature: Core tax APIs", () => {
  describe("Task: compute, validate, and compare", () => {
    it("computes a salary case, validates it, and compares regimes", async () => {
      await withServer(async (baseUrl) => {
        const periods = await getJson(baseUrl, "/api/v1/rules/periods");
        assert.deepEqual(
          periods.periods.map((period) => period.rulepack_id),
          ["ay-2025-26-v1", "ay-2026-27-v1"]
        );

        const salaryPayload = baseRequest({
          income: { salary: { gross_salary: 1275000 } },
          deductions: { standard_deduction: true }
        });
        const validation = await postJson(baseUrl, "/api/v1/tax/validate", salaryPayload);
        assert.equal(validation.status, "ok");
        assert.equal(validation.summary.blockers, 0);

        const compute = await postJson(baseUrl, "/api/v1/tax/compute", salaryPayload);
        assert.equal(compute.status, "ok");
        assert.equal(compute.summary.net_tax_liability, 0);

        const comparison = await postJson(baseUrl, "/api/v1/tax/compare-regimes", baseRequest({
          income: { salary: { gross_salary: 900000 } },
          deductions: { standard_deduction: true, chapter_via: [{ section: "80C", amount: 150000 }] }
        }));
        assert.equal(comparison.status, "ok");
        assert.ok(["old", "new"].includes(comparison.recommended_regime));
      });
    });
  });
});

describe("Feature: Support APIs", () => {
  describe("Task: report, import, privacy, ops, and launch smoke", () => {
    it("returns all support surfaces needed for a build-verification pass", async () => {
      await withServer(async (baseUrl) => {
        const report = await postJson(baseUrl, "/api/v1/reports/explain", baseRequest({
          income: { salary: { gross_salary: 1275000 } },
          deductions: { standard_deduction: true }
        }));
        assert.equal(report.status, "ok");
        assert.ok(report.downloads.json_filename.endsWith(".json"));
        assert.ok(report.downloads.html_filename.endsWith(".html"));

        const templates = await getJson(baseUrl, "/api/v1/imports/templates");
        assert.equal(templates.status, "ok");
        assert.ok(templates.templates.some((template) => template.import_type === "form16"));

        const preview = await postJson(baseUrl, "/api/v1/imports/preview", {
          import_type: "form16",
          filename: "form16.csv",
          content: "gross_salary,tds,deduction_80c,employer_name\n900000,45000,150000,Example Employer"
        });
        assert.equal(preview.status, "ok");
        assert.equal(preview.confirmation_required, true);

        const policy = await getJson(baseUrl, "/api/v1/privacy/policy");
        assert.equal(policy.privacy_version, "sprint7-v1");

        const metrics = await getJson(baseUrl, "/api/v1/ops/metrics");
        assert.equal(metrics.status, "ok");
        assert.equal(metrics.security.headers, "enabled");

        const beta = await getJson(baseUrl, "/api/v1/launch/beta-plan");
        assert.equal(beta.beta_status, "ready_for_closed_beta");

        const readiness = await getJson(baseUrl, "/api/v1/launch/readiness");
        assert.equal(readiness.machine_gate_status, "pass");
        assert.equal(readiness.public_launch_status, "blocked_pending_stakeholder_signoff");
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
