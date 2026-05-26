import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { buildServer } from "../../src/server.mjs";
import { explainTaxRequest, getSourceById } from "../../src/report-engine.mjs";

const vectors = JSON.parse(await readFile(new URL("../../sprint-zero/golden-test-vectors.json", import.meta.url), "utf8"));

describe("Sprint 5 UAT: Calculation Worksheet", () => {
  it("TC-S5-001 returns an explain report from the public API", async () => {
    await withServer(async (baseUrl) => {
      const response = await postJson(baseUrl, "/api/v1/reports/explain", vector("TV-001").input);
      assert.equal(response.status, "ok");
      assert.equal(response.report_version, "sprint5-v1");
      assert.ok(Array.isArray(response.worksheet));
      assert.ok(response.worksheet.length >= 10);
    });
  });

  it("TC-S5-002 includes every major worksheet line", async () => {
    const report = await explainTaxRequest(oldRegimeDeductionRequest());
    const lineIds = new Set(report.worksheet.map((line) => line.line_id));

    for (const expectedLine of [
      "gross_total_income",
      "standard_deduction",
      "chapter_via",
      "normal_tax",
      "rebate_87a",
      "cess",
      "net_tax_liability"
    ]) {
      assert.equal(lineIds.has(expectedLine), true, `${expectedLine} should be present`);
    }
  });

  it("TC-S5-003 links each worksheet line to applied rule IDs", async () => {
    const report = await explainTaxRequest(vector("TV-001").input);

    for (const line of report.worksheet) {
      assert.ok(Array.isArray(line.rule_ids), `${line.line_id} rule_ids should be an array`);
      assert.ok(line.rule_ids.length > 0, `${line.line_id} should have at least one rule ID`);
      assert.ok(line.rule_ids.every((ruleId) => typeof ruleId === "string" && ruleId.length > 0));
    }
  });

  it("TC-S5-004 links each worksheet line to source IDs", async () => {
    const report = await explainTaxRequest(vector("TV-001").input);

    for (const line of report.worksheet) {
      assert.ok(Array.isArray(line.source_ids), `${line.line_id} source_ids should be an array`);
      assert.ok(line.source_ids.length > 0, `${line.line_id} should have at least one source ID`);
      assert.ok(line.source_ids.every((sourceId) => sourceId.startsWith("SRC-")));
    }
  });

  it("TC-S5-006 separates special-rate tax from normal slab tax", async () => {
    const report = await explainTaxRequest(vector("TV-005").input);
    const specialRateLine = report.worksheet.find((line) => line.line_id === "special_rate_tax");
    const normalTaxLine = report.worksheet.find((line) => line.line_id === "normal_tax");

    assert.equal(specialRateLine.amount, 21875);
    assert.equal(normalTaxLine.amount, 60000);
    assert.equal(report.summary.special_rate_tax["112A"].tax_before_cess, 21875);
    assert.equal(report.summary.tax_before_rebate, 60000);
  });

  it("TC-S5-007 exposes the active rulepack version", async () => {
    const report = await explainTaxRequest(vector("TV-001").input);
    assert.equal(report.metadata.rulepack_version, "ay-2026-27-v1");
    assert.match(report.report_html, /Rulepack ay-2026-27-v1/);
  });

  it("TC-S5-008 exposes assumptions for review", async () => {
    const report = await explainTaxRequest(vector("TV-005").input);
    assert.ok(report.metadata.assumptions.includes("assessment_year 2026-27"));
    assert.ok(report.metadata.assumptions.includes("new regime"));
    assert.ok(report.metadata.assumptions.some((assumption) => assumption.includes("Section 87A rebate")));
    assert.match(report.report_html, /Assumptions/);
    assert.match(report.report_html, /new regime/);
  });
});

describe("Sprint 5 UAT: Rule Trace and Source Evidence", () => {
  it("TC-S5-009 returns source metadata for a valid source ID", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/sources/SRC-SECTION-87A`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.status, "ok");
      assert.equal(body.source.source_id, "SRC-SECTION-87A");
      assert.ok(body.source.title);
      assert.ok(body.source.publisher);
      assert.ok(["primary", "primary_with_note", "secondary"].includes(body.source.confidence));
    });
  });

  it("TC-S5-010 returns a structured error for an unknown source ID", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/sources/SRC-UNKNOWN-UAT`);
      assert.equal(response.status, 404);
      const body = await response.json();
      assert.equal(body.status, "error");
      assert.equal(body.error, "Source not found");
    });
  });

  it("TC-S5-011 includes the computation hash in support metadata", async () => {
    const report = await explainTaxRequest(vector("TV-001").input);
    assert.match(report.support.computation_hash, /^[a-f0-9]{64}$/);
  });

  it("TC-S5-012 includes the rulepack checksum in support metadata", async () => {
    const report = await explainTaxRequest(vector("TV-001").input);
    assert.match(report.support.rulepack_checksum, /^[a-f0-9]{64}$/);
  });

  it("TC-S5-015 keeps internal support report metadata free of raw PII", async () => {
    const report = await explainTaxRequest({
      ...vector("TV-001").input,
      pan: "ABCDE1234F",
      taxpayer_name: "Sensitive Person"
    });
    const serialized = JSON.stringify(report);
    assert.doesNotMatch(serialized, /ABCDE1234F/);
    assert.doesNotMatch(serialized, /Sensitive Person/);
  });
});

describe("Sprint 5 UAT: Downloadable Reports", () => {
  it("TC-S5-018 includes warnings in the report payload and HTML", async () => {
    const report = await explainTaxRequest(vector("TV-005").input);
    assert.ok(report.support.warnings.includes("WARN_REBATE_SPECIAL_RATE_LIMIT"));
    assert.match(report.report_html, /WARN_REBATE_SPECIAL_RATE_LIMIT/);
  });

  it("TC-S5-019 includes unsupported-scope validation notices without a silent estimate", async () => {
    const report = await explainTaxRequest({
      ...vector("TV-001").input,
      residency: "unknown"
    });
    assert.equal(report.support.validation_status, "blocked");
    assert.ok(report.support.validation_results.some((result) => result.code === "VAL_RESIDENCY_REQUIRED"));
    assert.match(report.report_html, /VAL_RESIDENCY_REQUIRED/);
  });

  it("TC-S5-020 includes ITR recommendation basis", async () => {
    const report = await explainTaxRequest(vector("TV-005").input);
    const itrLine = report.worksheet.find((line) => line.line_id === "itr_recommendation");

    assert.equal(report.itr_recommendation, "ITR-2");
    assert.equal(itrLine.value, "ITR-2");
    assert.match(itrLine.formula, /supported income-head complexity/i);
    assert.match(report.report_html, /Likely ITR form: ITR-2/);
  });

  it("TC-S5-021 keeps the known salary report snapshot stable", async () => {
    const report = await explainTaxRequest(vector("TV-001").input);
    const snapshot = report.worksheet.map((line) => ({
      line_id: line.line_id,
      category: line.category,
      source_ids: line.source_ids
    }));

    assert.deepEqual(snapshot.slice(0, 6), [
      { line_id: "gross_total_income", category: "income", source_ids: ["SRC-ITD-SALARIED-AY2026"] },
      { line_id: "salary_taxable", category: "income", source_ids: ["SRC-ITD-SALARIED-AY2026", "SRC-HRA-LTA-SALARIED-BENEFITS"] },
      { line_id: "standard_deduction", category: "deduction", source_ids: ["SRC-ITD-SALARIED-AY2026"] },
      { line_id: "chapter_via", category: "deduction", source_ids: ["SRC-ITD-SALARIED-AY2026"] },
      { line_id: "normal_income", category: "tax_base", source_ids: ["SRC-ITD-SALARIED-AY2026"] },
      { line_id: "total_income", category: "tax_base", source_ids: ["SRC-ITD-SALARIED-AY2026", "SRC-TAX-RATES-COMPUTATION"] }
    ]);
  });
});

function vector(id) {
  const found = vectors.vectors.find((item) => item.id === id);
  if (!found) throw new Error(`Missing vector ${id}`);
  return found;
}

function oldRegimeDeductionRequest() {
  return {
    period_type: "assessment_year",
    period: "2026-27",
    act: "Income-tax Act, 1961",
    taxpayer_type: "individual",
    residency: "resident",
    age_years: 34,
    regime: "old",
    income: {
      salary: { gross_salary: 900000 }
    },
    deductions: {
      standard_deduction: true,
      chapter_via: [{ section: "80C", amount: 150000 }]
    },
    tax_credits: {}
  };
}

async function withServer(callback) {
  const server = buildServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await callback(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
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
