import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildServer } from "../../src/server.mjs";

describe("Feature: Smoke checks", () => {
  describe("Task: service and static assets", () => {
    it("serves health and required browser assets", async () => {
      await withServer(async (baseUrl) => {
        const health = await getJson(baseUrl, "/health");
        assert.equal(health.status, "ok");

        for (const [path, contentType] of [
          ["/", /text\/html/],
          ["/styles.css", /text\/css/],
          ["/app.js", /text\/javascript/],
          ["/ui-validation.js", /text\/javascript/],
          ["/storage-state.js", /text\/javascript/]
        ]) {
          const response = await fetch(`${baseUrl}${path}`);
          assert.equal(response.status, 200, `${path} status`);
          assert.match(response.headers.get("content-type"), contentType, `${path} content-type`);
        }
      });
    });
  });
});

describe("Feature: API smoke checks", () => {
  describe("Task: supported salary flow", () => {
    it("validates, computes, and reports the salary happy path", async () => {
      await withServer(async (baseUrl) => {
        const periods = await getJson(baseUrl, "/api/v1/rules/periods");
        assert.ok(periods.periods.some((period) => period.period === "2026-27"));

        const payload = baseRequest({
          income: { salary: { gross_salary: 1275000 } },
          deductions: { standard_deduction: true }
        });
        const validation = await postJson(baseUrl, "/api/v1/tax/validate", payload);
        assert.equal(validation.status, "ok");
        assert.equal(validation.summary.blockers, 0);

        const compute = await postJson(baseUrl, "/api/v1/tax/compute", payload);
        assert.equal(compute.status, "ok");
        assert.equal(compute.summary.net_tax_liability, 0);

        const report = await postJson(baseUrl, "/api/v1/reports/explain", payload);
        assert.equal(report.status, "ok");
        assert.ok(report.downloads.json_filename.endsWith(".json"));
        assert.ok(report.downloads.html_filename.endsWith(".html"));
      });
    });
  });
});

describe("Feature: Support surface smoke checks", () => {
  describe("Task: import, privacy, ops, and launch endpoints", () => {
    it("returns the support endpoints needed for a smoke pass", async () => {
      await withServer(async (baseUrl) => {
        const importPreview = await postJson(baseUrl, "/api/v1/imports/preview", {
          import_type: "form16",
          filename: "form16.csv",
          content: "gross_salary,tds,deduction_80c,employer_name\n900000,45000,150000,Example Employer"
        });
        assert.equal(importPreview.status, "ok");

        const policy = await getJson(baseUrl, "/api/v1/privacy/policy");
        assert.equal(policy.status, "ok");

        const metrics = await getJson(baseUrl, "/api/v1/ops/metrics");
        assert.equal(metrics.status, "ok");

        const readiness = await getJson(baseUrl, "/api/v1/launch/readiness");
        assert.equal(readiness.machine_gate_status, "pass");
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
