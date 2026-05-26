import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { buildServer } from "../../src/server.mjs";
import { computeTax } from "../../src/tax-engine.mjs";
import { validateTaxRequest } from "../../src/validation-engine.mjs";

const vectors = await readJson("../../sprint-zero/golden-test-vectors.json");

describe("Sprint 3 UAT: Validation Framework", () => {
  it("TC-S3-001 returns validation results only from the validation endpoint", async () => {
    await withServer(async (baseUrl) => {
      const response = await postJson(baseUrl, "/api/v1/tax/validate", baseRequest({
        income: { salary: { gross_salary: 900000 } }
      }));

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.status, "ok");
      assert.equal(response.body.validation_version, "sprint3-v1");
      assert.deepEqual(response.body.summary, { blockers: 0, warnings: 0, infos: 0 });
      assert.equal(response.body.computation_hash, undefined);
      assert.equal(response.body.rule_trace, undefined);
      assert.equal(response.body.summary.net_tax_liability, undefined);
    });
  });

  it("TC-S3-002 returns a complete hard-blocker result shape", () => {
    const report = validateTaxRequest(baseRequest({ taxpayer_type: "company" }));

    assert.equal(report.status, "blocked");
    assert.equal(report.summary.blockers, 1);
    assertHasResult(report, "VAL_TAXPAYER_TYPE_UNSUPPORTED", "blocker", "taxpayer_type");
  });

  it("TC-S3-003 returns a complete warning result shape for HRA in the new regime", () => {
    const report = validateTaxRequest(vector("TV-016").input);

    assert.equal(report.status, "ok");
    assert.equal(report.summary.warnings, 1);
    assertHasResult(report, "WARN_HRA_NOT_AVAILABLE_NEW_REGIME", "warning", "income.salary.hra_received");
  });

  it("TC-S3-004 returns an info notice when advisory validation is requested", () => {
    const report = validateTaxRequest(baseRequest({
      options: { include_advisory_info: true },
      income: { salary: { gross_salary: 900000 } }
    }));

    assert.equal(report.status, "ok");
    assert.equal(report.summary.infos, 1);
    assertHasResult(report, "INFO_NEW_REGIME_DEFAULT", "info", "regime");
  });

  it("TC-S3-005 includes structured validation when compute requests it", async () => {
    const result = await computeTax({
      ...vector("TV-016").input,
      options: { include_validation: true }
    });

    assert.equal(result.status, "ok");
    assert.equal(result.validation_status, "ok");
    assert.equal(result.validation_summary.warnings, 1);
    assertHasResult(result, "WARN_HRA_NOT_AVAILABLE_NEW_REGIME", "warning", "income.salary.hra_received");
    assert.equal(typeof result.summary.net_tax_liability, "number");
  });

  it("TC-S3-006 omits structured validation when compute does not request it", async () => {
    const result = await computeTax(vector("TV-016").input);

    assert.equal(result.status, "ok");
    assert.equal(result.validation_results, undefined);
    assert.equal(result.validation_summary, undefined);
    assert.equal(result.validation_status, undefined);
    assert.ok(result.warnings.includes("WARN_HRA_NOT_AVAILABLE_NEW_REGIME"));
  });

  it("TC-S3-007 preserves multiple validation results without overwriting", () => {
    const report = validateTaxRequest(baseRequest({
      regime: "old",
      income: {
        salary: {
          basic_salary: 0,
          hra_received: 120000,
          rent_paid: -1000
        }
      },
      deductions: {
        chapter_via: [
          { section: "80EE", amount: 50000 },
          { section: "80EEA", amount: 150000 }
        ]
      }
    }));

    assert.equal(report.status, "blocked");
    assertHasResult(report, "VAL_SALARY_AMOUNT_NEGATIVE", "blocker", "income.salary.rent_paid");
    assertHasResult(report, "VAL_HRA_SALARY_BASE_REQUIRED", "blocker", "income.salary.basic_salary");
    assertHasResult(report, "WARN_80EE_80EEA_MUTUAL_EXCLUSION", "blocker", "deductions.chapter_via");
    assert.equal(new Set(report.results.map((result) => `${result.code}:${result.field_path}`)).size, report.results.length);
  });

  it("TC-S3-008 ships UI hooks for inline validation messages", async () => {
    const html = await readText("../../public/index.html");
    const app = await readText("../../public/app.js");

    assert.match(html, /id="validation-output"/);
    assert.match(html, /data-testid="validation-output"/);
    assert.match(app, /function renderValidation/);
    assert.match(app, /data-testid="validation-message"/);
    assert.match(app, /result\.field_path/);
    assert.match(app, /result\.remediation_hint/);
  });

  it("TC-S3-009 exposes validation messages through a screen-reader live region", async () => {
    const html = await readText("../../public/index.html");

    assert.match(html, /id="validation-output"[^>]*role="status"/);
    assert.match(html, /id="validation-output"[^>]*aria-live="polite"/);
  });

  it("TC-S3-010 keeps validation warning parity for TV-001 through TV-030", () => {
    for (const testVector of vectors.vectors) {
      const report = validateTaxRequest(testVector.input);
      const expectedCodes = new Set(testVector.expected.warnings);
      const actualCodes = new Set(report.results.filter((result) => result.severity !== "info").map((result) => result.code));

      assert.deepEqual(actualCodes, expectedCodes, `${testVector.id} validation codes`);
    }
  });
});

describe("Sprint 3 UAT: Year, Law, and Regime Validation", () => {
  it("TC-S3-011 accepts supported assessment-year selection", () => {
    const report = validateTaxRequest(baseRequest({ period_type: "assessment_year", period: "2026-27" }));

    assert.equal(report.status, "ok");
    assert.equal(report.summary.blockers, 0);
    assert.equal(report.hard_blockers.length, 0);
  });

  it("TC-S3-012 blocks unsupported tax-year rulepack selection", () => {
    const report = validateTaxRequest(baseRequest({ period_type: "tax_year", period: "2026-27" }));

    assert.equal(report.status, "blocked");
    assertHasResult(report, "VAL_TAX_YEAR_RULEPACK_NOT_ACTIVE", "blocker", "period_type");
  });

  it("TC-S3-013 blocks an act and assessment-year mismatch", () => {
    const report = validateTaxRequest(baseRequest({ act: "Income-tax Act, 2025" }));

    assert.equal(report.status, "blocked");
    assertHasResult(report, "VAL_ACT_PERIOD_MISMATCH", "blocker", "act");
  });

  it("TC-S3-014 warns and ignores old-regime deductions entered under the new regime", async () => {
    const request = baseRequest({
      regime: "new",
      deductions: { chapter_via: [{ section: "80C", amount: 150000 }] }
    });
    const report = validateTaxRequest(request);
    const result = await computeTax(request);

    assertHasResult(report, "WARN_CHAPTER_VIA_DEDUCTIONS_IGNORED_NEW_REGIME", "warning", "deductions.chapter_via");
    assert.equal(result.summary.chapter_via_allowed, 0);
    assert.ok(result.warnings.includes("WARN_CHAPTER_VIA_DEDUCTIONS_IGNORED_NEW_REGIME"));
  });

  it("TC-S3-015 returns the new-regime advisory info notice", () => {
    const report = validateTaxRequest(baseRequest({
      options: { include_advisory_info: true },
      deductions: { chapter_via: [{ section: "80C", amount: 150000 }] }
    }));

    assertHasResult(report, "INFO_NEW_REGIME_DEFAULT", "info", "regime");
    assert.ok(report.results.find((result) => result.code === "INFO_NEW_REGIME_DEFAULT").remediation_hint.includes("old-vs-new comparison"));
  });

  it("TC-S3-016 warns that rebate does not wipe out special-rate 112A tax", async () => {
    const request = vector("TV-005").input;
    const report = validateTaxRequest(request);
    const result = await computeTax(request);

    assertHasResult(report, "WARN_REBATE_SPECIAL_RATE_LIMIT", "warning", "income.capital_gains[0]");
    assert.equal(result.summary.rebate_87a_offsets_special_rate_tax, false);
    assert.ok(result.summary.special_rate_tax["112A"].tax_before_cess > 0);
  });

  it("TC-S3-017 blocks a missing regime selection", () => {
    const report = validateTaxRequest(baseRequest({ regime: "" }));

    assert.equal(report.status, "blocked");
    assertHasResult(report, "VAL_REGIME_UNSUPPORTED", "blocker", "regime");
  });
});

describe("Sprint 3 UAT: Provision-Specific Validation", () => {
  it("TC-S3-018 blocks HRA when annual rent is zero", () => {
    const report = validateTaxRequest(baseRequest({
      regime: "old",
      income: { salary: { basic_salary: 700000, hra_received: 120000, rent_paid: 0 } }
    }));

    assert.equal(report.status, "blocked");
    assertHasResult(report, "VAL_HRA_RENT_REQUIRED", "blocker", "income.salary.rent_paid");
  });

  it("TC-S3-019 blocks HRA when salary base is missing", () => {
    const report = validateTaxRequest(baseRequest({
      regime: "old",
      income: { salary: { hra_received: 120000, rent_paid: 180000, basic_salary: 0 } }
    }));

    assert.equal(report.status, "blocked");
    assertHasResult(report, "VAL_HRA_SALARY_BASE_REQUIRED", "blocker", "income.salary.basic_salary");
  });

  it("TC-S3-020 warns and caps an 80C claim above Rs. 1.5 lakh", async () => {
    const report = validateTaxRequest(vector("TV-021").input);
    const result = await computeTax(vector("TV-021").input);

    assertHasResult(report, "WARN_80C_CAP_APPLIED", "warning", "deductions.chapter_via[0].amount");
    assert.equal(result.summary.deductions["80C"].allowed, 150000);
  });

  it("TC-S3-021 warns and caps an 80D bucket over its limit", async () => {
    const report = validateTaxRequest(vector("TV-022").input);
    const result = await computeTax(vector("TV-022").input);

    assertHasResult(report, "WARN_80D_PREVENTIVE_INCLUDED_IN_BUCKET_CAP", "warning", "deductions.chapter_via[0]");
    assert.equal(result.summary.deductions["80D"].self_family_allowed, 25000);
    assert.equal(result.summary.deductions["80D"].parents_allowed, 50000);
  });

  it("TC-S3-022 blocks simultaneous 80EE and 80EEA claims", () => {
    const report = validateTaxRequest(vector("TV-025").input);

    assert.equal(report.status, "blocked");
    assertHasResult(report, "WARN_80EE_80EEA_MUTUAL_EXCLUSION", "blocker", "deductions.chapter_via");
  });

  it("TC-S3-023 warns when multiple 112A rows require annual threshold aggregation", () => {
    const report = validateTaxRequest(baseRequest({
      income: {
        capital_gains: [
          { section: "112A", transfer_date: "2025-08-15", net_gain: 200000 },
          { section: "112A", transfer_date: "2025-09-15", net_gain: 100000 }
        ]
      }
    }));

    assertHasResult(report, "WARN_112A_THRESHOLD_AGGREGATION_REQUIRED", "warning", "income.capital_gains");
  });

  it("TC-S3-024 warns when presumptive 44AD turnover breaches the threshold", async () => {
    const request = baseRequest({
      income: {
        business_profession: [
          { section: "44AD", turnover: 35000000, cash_receipts: 0, digital_receipts: 35000000 }
        ]
      }
    });
    const report = validateTaxRequest(request);
    const result = await computeTax(request);

    assertHasResult(report, "WARN_44AD_TURNOVER_LIMIT_EXCEEDED", "warning", "income.business_profession[0].turnover");
    assert.equal(result.summary.business_profession["44AD"].eligible_under_turnover_limit, false);
    assert.ok(result.warnings.includes("WARN_44AD_TURNOVER_LIMIT_EXCEEDED"));
  });

  it("TC-S3-025 warns when the 44AD cash percentage breaches enhanced-threshold rules", () => {
    const report = validateTaxRequest(vector("TV-027").input);

    assertHasResult(report, "WARN_44AD_ENHANCED_THRESHOLD_UNAVAILABLE", "warning", "income.business_profession[0].cash_receipts");
  });

  it("TC-S3-026 warns when a regular taxpayer has an advance-tax shortfall", () => {
    const report = validateTaxRequest(vector("TV-030").input);

    assertHasResult(report, "WARN_ADVANCE_TAX_SHORTFALL_REGULAR_CASE", "warning", "cases.regular.advance_tax_paid_by_dates");
  });

  it("TC-S3-027 leaves blank optional sections clean", () => {
    const report = validateTaxRequest(baseRequest({ income: {}, deductions: { standard_deduction: true } }));

    assert.equal(report.status, "ok");
    assert.deepEqual(report.codes, []);
    assert.deepEqual(report.summary, { blockers: 0, warnings: 0, infos: 0 });
  });
});

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

async function readText(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

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

function vector(id) {
  const found = vectors.vectors.find((item) => item.id === id);
  if (!found) throw new Error(`Missing vector ${id}`);
  return found;
}

function assertHasResult(report, code, severity, fieldPath) {
  const result = (report.results ?? report.validation_results).find((item) => item.code === code && item.field_path === fieldPath);
  assert.ok(result, `expected validation result ${code} at ${fieldPath}; got ${JSON.stringify(report.results ?? report.validation_results)}`);
  assert.equal(result.severity, severity, `${code} severity`);
  assert.equal(result.field_path, fieldPath, `${code} field_path`);
  assert.equal(typeof result.message_key, "string", `${code} message_key`);
  assert.equal(typeof result.source_rule, "string", `${code} source_rule`);
  assert.equal(typeof result.remediation_hint, "string", `${code} remediation_hint`);
  assert.doesNotMatch(result.remediation_hint, /Sprint \d|sprint\d+-v\d+/i);
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

async function postJson(baseUrl, path, payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return {
    statusCode: response.status,
    body: await response.json()
  };
}
