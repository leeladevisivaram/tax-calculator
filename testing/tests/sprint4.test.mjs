import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { buildServer } from "../../src/server.mjs";

describe("Sprint 4 wizard UI", () => {
  it("serves the application shell and frontend assets", async () => {
    const server = buildServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const htmlResponse = await fetch(`${baseUrl}/`);
      assert.equal(htmlResponse.status, 200);
      assert.match(htmlResponse.headers.get("content-type"), /text\/html/);
      const html = await htmlResponse.text();
      assert.match(html, /Explainable tax estimate/);
      assert.match(html, /id="tax-wizard"/);
      assert.match(html, /data-step="income"/);
      assert.match(html, /POST \/api\/v1\/tax\/validate|Validate/);

      const cssResponse = await fetch(`${baseUrl}/styles.css`);
      assert.equal(cssResponse.status, 200);
      assert.match(cssResponse.headers.get("content-type"), /text\/css/);

      const jsResponse = await fetch(`${baseUrl}/app.js`);
      assert.equal(jsResponse.status, 200);
      assert.match(jsResponse.headers.get("content-type"), /text\/javascript/);
      const js = await jsResponse.text();
      assert.match(js, /buildRequest/);
      assert.match(js, /\/api\/v1\/tax\/compute/);
      assert.match(js, /\/api\/v1\/tax\/compare-regimes/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("supports salary, capital-gains, and presumptive flows used by the UI", async () => {
    const server = buildServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const salaryResult = await postJson(baseUrl, "/api/v1/tax/compute", baseRequest({
        income: { salary: { gross_salary: 1275000 } },
        deductions: { standard_deduction: true },
        options: { include_validation: true }
      }));
      assert.equal(salaryResult.summary.net_tax_liability, 0);
      assert.equal(salaryResult.validation_status, "ok");

      const capitalGainValidation = await postJson(baseUrl, "/api/v1/tax/validate", baseRequest({
        income: {
          salary: { gross_salary: 1275000 },
          capital_gains: [{ section: "112A", transfer_date: "2025-08-15", net_gain: 300000, stt_paid: true }]
        },
        deductions: { standard_deduction: true }
      }));
      assert.ok(capitalGainValidation.warnings.includes("WARN_REBATE_SPECIAL_RATE_LIMIT"));

      const presumptiveResult = await postJson(baseUrl, "/api/v1/tax/compute", baseRequest({
        income: {
          business_profession: [{ section: "44AD", turnover: 25000000, cash_receipts: 1000000, digital_receipts: 24000000 }]
        },
        deductions: { standard_deduction: true },
        options: { include_validation: true }
      }));
      assert.equal(presumptiveResult.summary.business_profession["44AD"].deemed_income, 1520000);

      const comparison = await postJson(baseUrl, "/api/v1/tax/compare-regimes", baseRequest({
        income: { salary: { gross_salary: 900000 } },
        deductions: { standard_deduction: true, chapter_via: [{ section: "80C", amount: 150000 }] }
      }));
      assert.equal(comparison.status, "ok");
      assert.ok(["old", "new"].includes(comparison.recommended_regime));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("contains the expected manual workflow controls", async () => {
    const html = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
    for (const name of [
      "gross_salary",
      "hra_received",
      "capital_gain_section",
      "business_section",
      "deduction_80c",
      "tds"
    ]) {
      assert.match(html, new RegExp(`name="${name}"`));
    }
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

async function postJson(baseUrl, path, payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.equal(response.status, 200);
  return response.json();
}
