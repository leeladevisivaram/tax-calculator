import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { buildServer } from "../../src/server.mjs";
import { computeTax } from "../../src/tax-engine.mjs";
import { validateTaxRequest } from "../../src/validation-engine.mjs";

const vectors = JSON.parse(await readFile(new URL("../../sprint-zero/golden-test-vectors.json", import.meta.url), "utf8"));

function vector(id) {
  const found = vectors.vectors.find((item) => item.id === id);
  if (!found) throw new Error(`Missing vector ${id}`);
  return found;
}

describe("Sprint 3 validation engine", () => {
  it("returns UI-ready validation results for blocker, warning, and info severities", () => {
    const blockerReport = validateTaxRequest({
      period_type: "assessment_year",
      period: "2026-27",
      act: "Income-tax Act, 1961",
      taxpayer_type: "individual",
      residency: "resident",
      age_years: 34,
      regime: "old",
      income: { salary: { hra_received: 100000, rent_paid: 120000 } }
    });
    assert.equal(blockerReport.status, "blocked");
    assertHasResult(blockerReport, "VAL_HRA_SALARY_BASE_REQUIRED", "blocker", "income.salary.basic_salary");

    const warningReport = validateTaxRequest(vector("TV-015").input);
    assert.equal(warningReport.status, "ok");
    assertHasResult(warningReport, "WARN_LANDLORD_PAN_MAY_BE_REQUIRED", "warning", "income.salary.rent_paid");

    const infoReport = validateTaxRequest({
      period_type: "assessment_year",
      period: "2026-27",
      act: "Income-tax Act, 1961",
      taxpayer_type: "individual",
      residency: "resident",
      age_years: 34,
      regime: "new",
      options: { include_advisory_info: true },
      income: { salary: { gross_salary: 800000 } }
    });
    assertHasResult(infoReport, "INFO_NEW_REGIME_DEFAULT", "info", "regime");
  });

  it("matches golden-vector warning expectations for TV-001 through TV-030", () => {
    for (const testVector of vectors.vectors) {
      const report = validateTaxRequest(testVector.input);
      const expectedCodes = new Set(testVector.expected.warnings);
      const actualCodes = new Set(report.results.filter((result) => result.severity !== "info").map((result) => result.code));
      assert.deepEqual(actualCodes, expectedCodes, `${testVector.id} validation codes`);
    }
  });

  it("serves validation endpoint independently of compute", async () => {
    const server = buildServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/api/v1/tax/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(vector("TV-016").input)
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.status, "ok");
      assertHasResult(body, "WARN_HRA_NOT_AVAILABLE_NEW_REGIME", "warning", "income.salary.hra_received");
      assert.equal(body.summary.warnings, 1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("can include structured validation in compute when requested", async () => {
    const testVector = vector("TV-027");
    const result = await computeTax({
      ...testVector.input,
      options: { include_validation: true }
    });

    assert.equal(result.status, "ok");
    assert.equal(result.validation_status, "ok");
    assertHasResult(result, "WARN_44AD_ENHANCED_THRESHOLD_UNAVAILABLE", "warning", "income.business_profession[0].cash_receipts");
  });
});

function assertHasResult(report, code, severity, fieldPath) {
  const result = (report.results ?? report.validation_results).find((item) => item.code === code);
  assert.ok(result, `expected validation result ${code}`);
  assert.equal(result.severity, severity, `${code} severity`);
  assert.equal(result.field_path, fieldPath, `${code} field_path`);
  assert.ok(result.message_key, `${code} message_key`);
  assert.ok(result.source_rule, `${code} source_rule`);
  assert.ok(result.remediation_hint, `${code} remediation_hint`);
}
